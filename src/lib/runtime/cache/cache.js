import LRU from 'lru-cache'
import { Request, Response } from '../fetch.js'
import CFCachePolicy from './cloudflareCachePolicy.js'
import chalk from 'chalk'
import { Table } from '@author.io/node-shell'
import fs from 'fs'
import path from 'path'
import TaskRunner from 'shortbus'

class CacheFactory {
  constructor () {
    Object.defineProperties(this, {
      default: {
        value: new Cache(),
        writable: false
      },
      filepath: {
        value: null,
        writable: true,
        enumerable: false
      }
    })

    this.default.onSave = () => this.save()
  }

  set file (value) {
    this.default.loading = this.filepath === null
    this.filepath = path.resolve(value)
    this.load(true)
  }

  open (name) {
    return new Cache()
  }

  clear () {
    this.default.cache = new LRU()
    this.save()
    console.log(chalk.yellow.bold('::: Cleared Cache (No items remaining)'))
  }

  save () {
    if (this.filepath === null) {
      this.filepath = path.join(process.cwd(), '.cloudflare_worker_cache')
      this.loading = false
    }

    let result = this.default.cache.dump().map(item => {
      let response = {}

      Object.getOwnPropertySymbols(item.v).forEach(s => {
        if (s.toString().indexOf('Response') > 0) {
          for (let [key, value] of Object.entries(item.v[s])) {
            if (key !== 'headers') {
              response[key] = value
            }
          }
        } else if (s.toString().indexOf('Body') > 0) {
          response.body = item.v[s].body
        }
      })

      response.headers = Object.fromEntries(item.v.clone().headers)

      item.v = response

      return item
    })

    const tasks = new TaskRunner()

    tasks.on('complete', () => fs.writeFileSync(this.filepath, JSON.stringify(result)))

    for (const el of result) {
      tasks.add(next => {
        const body = []
        const stream = new ReadableStream()
        stream.on('data', c => body.push(c))
        stream.on('end', () => {
          el.v.body = body.join()
          next()
        })

        el.v.body.pipe(stream)
      })
    }
  }

  load (force = false) {
    if (force || !this.default.loading) {
      this.default.loading = true

      try {
        let data = JSON.parse(fs.readFileSync(this.filepath, { encoding: 'utf8' }))
        data.forEach(item => {
          let req = new Request(item.k)
          let res = new Response(item.v.body, {
            status: item.v.status,
            statusText: item.v.statusText,
            headers: item.v.headers
          })

          this.default.put(req, res)
        })

        console.log(chalk.grey(`* Loaded ${data.length} response${data.length !== 1 ? 's' : ''} from disk into the runtime cache.\n`))
      } catch (e) {}

      this.default.loading = false
    }
  }
}

function streamToString(stream) {
  const chunks = []
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => chunks.push(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

const priv = v => Object.create({
  enumerable: false,
  writable: true,
  configurable: false,
  value: v
})

class Cache {
  constructor () {
    Object.defineProperties(this, {
      cache: priv(new LRU()),
      cacheKey: priv(req => (typeof req === 'string' || req instanceof String) ? req : req.url),
      cacheReq: priv(req => (typeof req === 'string' || req instanceof String) ? new Request(req) : req),
      fail: priv((req, reason) => {
        console.log('\n' + chalk.yellow(`  * ${chalk.bold('Request Not Cached')}\n\n${new Table([[req.method, req.url]], null, ['10%'], 70, [4]).output}`))
        console.log('\n' + reason + '\n')
        return Promise.resolve(undefined)
      }),
      saveFn: { enumerable: false, writable: true, configurable: false, value: null },
      save: priv(() => {
        if (typeof this.saveFn === 'function') {
          this.saveFn()
        }
      }),
      loading: { enumerable: false, writable: true, value: false }
    })
  }

  set onSave (fn) {
    this.saveFn = fn
  }

  async put (req, res) {
    if (res.status === 206) {
      return Promise.resolve(undefined)
    }

    const cacheKey = this.cacheKey(req)
    const cacheReq = this.cacheReq(req)
    const cacheRes = res
    const policy = new CFCachePolicy(cacheReq, cacheRes, {
      immutableMinTimeToLive: 3600 * 1000
    })

    if (!policy.storable() || policy.timeToLive() === 0) {
      if (!policy.storable()) {
        return this.fail(req, chalk.grey('Cache policy violation (not storable).'))
      } else if (policy.timeToLive() === 0) {
        this.fail(req, chalk.grey.bold('    Check the RESPONSE headers to assure the appropriate caching headers exist:' + '\n\n') +
          chalk.grey(new Table(Array.from(new Map(res.headers)), null, ['35%'], 60, [4]).output))
      }

      return Promise.resolve(undefined)
    }

    return new Promise((resolve, reject) => {
      this.cache.set(cacheKey, cacheRes, policy.timeToLive())
      this.save()
      resolve(undefined)
      !this.loading && console.log(chalk.italic.yellow(`    Response successfully cached. Expires in ${(policy.timeToLive() / 1000).toFixed(0)}s.\n`))
    })
  }

  async match (req, options = {}) {
    const cacheKey = this.cacheKey(req)

    return new Promise((resolve, reject) => {
      let cachedRes = this.cache.get(cacheKey)
      if (cachedRes !== undefined) {
        const policy = new CFCachePolicy(req, cachedRes, {
          shared: true,
          cacheHeuristic: 0.1,
          immutableMinTimeToLive: 24 * 3600 * 1000
        })

        cachedRes = cachedRes.clone()
        cachedRes.headers.set('cf-cache-status', 'HIT')

        console.log(chalk.blue.dim('    ::: Used cached response.\n'))
      }

      resolve(cachedRes)
    })
  }

  async delete (req, options = {}) {
    const cacheKey = this.cacheKey(req)
    const cacheReq = this.cacheReq(req)

    if (cacheReq.method !== 'GET' || options.ignoreMethod) {
      return Promise.resolve(undefined)
    }

    return new Promise((resolve, reject) => {
      const cachedRes = this.cache.peek(cacheKey)
      if (cachedRes === undefined) {
        resolve(false)
      }

      this.cache.del(cacheKey)
      this.save()
      resolve(true)
    })
  }

  async get () {
    console.log(chalk.bold.red('cache.get is not a valid method. ') + '\n\n' + chalk.yellow('Did you mean ' + chalk.bold('cache.match?')))
    let stack = []
    for (let line of new Error().stack.split('\n').splice(2)) {
      if (line.indexOf('at EventEmitter') >= 0) {
        break
      }
      stack.push(line)
    }

    console.log(chalk.yellow(stack.join('\n')))

    return Promise.resolve(undefined)
  }
}

export { CacheFactory as default, CacheFactory, Cache as _Cache }
