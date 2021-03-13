import http from 'http'
import vm from 'vm'
import chalk from 'chalk'
import path from 'path'
import TrackTime from 'node-tracktime'
import { EventEmitter } from 'events'
import { Table } from '@author.io/node-shell'
import CacheFactory from './runtime/cache/cache.js'
// import StubCacheFactory from './runtime/cache/stub.js'
import {
  Context as RuntimeContext,
  Request,
  bindCfProperty,
  freezeHeaders,
  FetchEvent
} from './runtime/index.js'
import KeyValueStore from './kv.js'
import Router from './api.js'
import Configuration from './config.js'
import Vault from './secrets.js'

let REQUEST_COUNT = 0
const BYTES_PER_MB = 1000000

export default class CFServer {
  #port = process.env.PORT || 3000
  #code
  #server
  #status = 'offline'
  #connections = new Map()
  #cache = new CacheFactory()
  #wasm
  #emitter = new EventEmitter()
  #headers = new Map()
  #dispatcher = new EventEmitter()
  #loading = false
  #store = new Map()
  #filepath = 'cloudflareworker'
  #router
  #host = 'example.com'
  #env = new Map()
  #activeEnv
  #config = new Configuration()
  #vault = new Vault()

  constructor (worker, wasm = {}, cache = false) {
    this.#wasm = wasm
    this.#code = worker

    this.addStore('defaultkv')
  }

  get cache () {
    return this.#cache
  }

  set cachefile (value) {
    this.#cache.file = value
  }

  clearCache () {
    this.#cache.clear()
  }

  get config () {
    return this.#config
  }

  set filepath (value) {
    this.#filepath = value
  }

  secrets (value, key = null) {
    value = path.resolve(value)

    if (!fs.existsSync(value)) {
      console.log(chalk.red.bold(`Could not find secrets file at "${value}"`))
    } else {
      this.#vault = new Vault(value, key)
      this.worker = this.#code
    }
  }

  set worker (code) {
    if (!this.#loading) {
      this.#code = code
      this.#loading = true
      this.#dispatcher.removeAllListeners()

      let bindings = this.#wasm

      // Apply Cache API
      bindings.cache = this.#cache

      // Apply KV Stores
      this.#store.forEach((store, name) => bindings[name] = store)

      // Apply config environment variables
      bindings = Object.assign(bindings, this.#config.variables)

      // Apply environment variables (from flags)
      this.#env.forEach((value, env) => bindings[env] = value)

      // Apply secrets
      bindings = Object.assign(bindings, Object.fromEntries(this.#vault.___))

      let runtime = vm.createContext(new RuntimeContext((type, handler) => this.#dispatcher.on(type, event => Promise.resolve(handler(event)).catch(event.onError)), this.#cache, bindings), {
        codeGeneration: {
          strings: false
        }
      })

      // This hack prevents the script from outputting in the console until it is executed.
      const out = console.log
      console.log = () => {}

      let pre = null
      if (process.env.MEMORY_MANAGEMENT_ENABLED) {
        (async () => pre = await vm.measureMemory({ mode: 'summary', execution: 'eager' }, runtime).catch(e => console.error(e)))()
      }

      vm.runInContext(code, runtime, {
        filename: this.#filepath,
        timeout: 300,
        breakOnSigint: true,
        displayErrors: true
      })
      console.log = out

      this.#dispatcher.on('fetch', async () => {
        if (process.env.MEMORY_MANAGEMENT_ENABLED) {
          const final = await vm.measureMemory({ mode: 'summary', execution: 'eager' }, runtime).catch(e => console.error(e))
          const result = final.total.jsMemoryEstimate - pre.total.jsMemoryEstimate

          if (result) {
            const consumed = (result / BYTES_PER_MB).toFixed(3)

            if (consumed > 128) {
              console.log(chalk.red.bold(`::: Worker consumed ${consumed}MB\n::: Exceeds CloudFlare Maximum`))
            } else if (consumed >= 100) {
              console.log(chalk.red(`::: Worker consumed ${consumed}MB`))
            } else if (consumed >= 50) {
              console.log(chalk.yellow.bold(`::: Worker consumed ${consumed}MB`))
            } else if (consumed >= 1) {
              console.log(chalk.yellow.dim(`::: Worker consumed ${consumed}MB`))
            } else if (consumed < 0) {
              console.log(chalk.dim('::: Worker consumed less than 1KB'))
            } else {
              console.log(chalk.dim(`::: Worker consumed ${consumed}MB`))
            }
          }
        }
      })

      this.#loading = false
      this.emit('loaded')
    }
  }

  set environment (value) {
    if (Array.isArray(value)) {
      this.#env = new Map()
      value.forEach(keypair => {
        console.log(chalk.blue(`* Env: ${keypair}`))
        this.#env.set(...keypair.split('=').map(i => i.trim()))
      })

      this.worker = this.#code
    }
  }

  set configuration (value) {
    this.#config = value
    this.#host = this.#config.route
  }

  get config () {
    return this.#config
  }

  use (cfg) {
    this.#config.use(cfg)
    this.#host = this.#config.route
  }

  addStore (namespace, filepath = null) {
    const kvs = new KeyValueStore(filepath, namespace)
    kvs.namespace = namespace

    this.#store.set(namespace, kvs)

    if (this.online) {
      this.worker = this.#code
    }

    return kvs
  }

  get stores () {
    return this.#store
  }

  store (name) {
    return this.#store.get(name)
  }

  get namespaces () {
    return Array.from(this.#store.keys())
  }

  get persistKV () {
    return this.#store.persistent
  }

  applyKvStoreItems (data = {}, namespace = 'defaultkv') {
    if (!this.#store.has(namespace)) {
      this.addStore(namespace)
    }

    this.#store.get(namespace).apply(data)
  }

  async trigger (event) {
    return await this.#dispatcher.emit('fetch', event)
  }

  addHeader (name, value) {
    this.#headers.set(name.trim(), value.trim())
  }

  on () {
    this.#emitter.on(...arguments)
  }

  once() {
    this.#emitter.once(...arguments)
  }

  emit() {
    this.#emitter.emit(...arguments)
  }

  off() {
    this.#emitter.off(...arguments)
  }

  removeAllListeners () {
    this.#emitter.removeAllListeners(...arguments)
  }

  set status (current) {
    const old = this.#status
    current = current.trim().toLowerCase()

    if (current !== old) {
      this.#status = current
      this.emit('status.change', { old, current })
      this.#emitter.emit(current)
    }
  }

  get status () { return this.#status }
  get stopping () { return this.#status === 'stopping' }
  get starting () { return this.#status === 'starting' }
  get restarting () { return this.#status === 'restarting' }
  get online () { return this.#status === 'online' }
  get offline () { return this.#status === 'offline' }
  get port () { return this.#port }
  set port (p) {
    if (!isNaN(p)) {
      this.#port = p
    }
  }

  get host () {
    if (!this.#server) {
      return 'offline'
    }

    return this.localhost
  }

  get localhost () {
    return `${this.#server.address().address.replace(/^:{2,}|(192|172|127)(\.\d+){3}$/i, 'localhost')}:${this.#server.address().port}`
  }

  abort (e) {
    if (e) {
      console.log(chalk.red(e.message))
    }

    this.closeConnections()

    process.exit(1)
  }

  closeConnections () {
    if (this.#connections.length > 0) {
      this.#connections.forEach(socket => socket.destroy())
    }
  }

  start (restarting = false) {
    if (this.#status === 'offline') {
      this.status = 'starting'
      this.worker = this.#code
      this.#server = http.createServer(this.handle.bind(this))
      this.#router = new Router(this)
      this.#server.on('error', e => this.abort(e))
      this.#server.on('close', () => {
        this.closeConnections()

        if (!this.restarting) {
          console.log(chalk.yellow.bold(`Worker is offline.`))
        }

        this.status = 'offline'
      })
      this.#server.on('listening', () => {
        this.status = 'online'
      })
      this.#server.on('connection', socket => {
        socket.setNoDelay()
        socket.id = Symbol('connection')
        socket.on('close', () => this.#connections.delete(socket.id))
        this.#connections.set(socket.id, socket)
      })

      if (!restarting) {
        this.on('online', () => console.log('\n' + chalk.green.bold(`Worker is running at http://${this.host}`)))
      }

      this.#server.listen(process.env.PORT)
    }
  }

  stop () {
    if (this.online || this.restarting) {
      if (!this.restarting) {
        this.status = 'stopping'
      }

      this.#server.close()
    }
  }

  restart () {
    if (this.online) {
      this.status = 'restarting'
      console.log(chalk.grey('Reloading service.'))
      this.once('offline', () => {
        this.removeAllListeners()
        this.once('online', () => console.log(chalk.green.bold('Successfully reloaded service.')))
        this.start(true)
      })
      this.stop()
    }
  }

  async handle (req, res) {
    // Route API requests appropriately
    if (req.url.indexOf('/api/') === 0) {
      return await API.route(...arguments)
    }

    console.log('\n' + chalk.grey(new Table([['Request', 'at ' + new Date().toLocaleTimeString()],[req.method.toUpperCase(), `http://${this.#config.route.replace(/\/\*$/, '')}${req.url}`]], null, ['10%'], 75, [4,0,0,1]).output))

    const url = `http://${req.headers['host']}${req.url}`

    // Apply custom headers
    if (this.#headers.size > 0) {
      this.#headers.forEach((val, name) => req.headers[name] = val)
    }

    let body = null
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const te = req.headers['transfer-encoding'] || ''
      // If transfer encoding is chunked, stream body
      if (te.split(',').map(s => s.trim()).includes('chunked')) {
        body = req
      } else { // otherwise, read body into buffer
        const temp = new Request(url, { headers: req.headers, body: req, method: req.method })
        body = await temp.buffer()
      }
    }

    // Replicate CloudFlare headers
    const request = new Request(url, { headers: req.headers, body, method: req.method })
    bindCfProperty(request)
    request.headers.set('CF-Connecting-IP', req.connection.remoteAddress)
    freezeHeaders(request.headers)

    // Begin worker processing
    const stopwatch = new TrackTime()

    const event = new FetchEvent('fetch', { request: request })
    event.respondWith = this.respondWith(res, stopwatch)
    event.waitUntil = () => { }
    event.onError = this.error(res, stopwatch)

    try {
      let timeout = setTimeout(() => {
        if (this.reply(res, 504, 'Request timed out while waiting for worker to respond.')) {
          console.log(chalk.yellow(`    ::: No response after ${stopwatch.measure().display_ms}`))
        }
      }, 2000)

      res.on('end', () => clearTimeout(timeout))

      await this.trigger(event)
    } catch (error) {
      this.error(res, stopwatch)(error)
    }
  }

  log (res, timer) {
    if (!timer) {
      return
    }

    const duration = timer.measure()

    if (duration.milliseconds > 10) {
      if (duration.milliseconds > 50) {
        console.log(chalk.red.bold(`    ::: Completed in ${duration.display_ms}.\n`))
      } else {
        console.log(chalk.yellow(`    ::: Completed in ${duration.display_ms}.\n`))
      }
    } else {
      console.log(chalk.green(`    ::: Completed in ${duration.display_ms}.\n`))
    }
  }

  error (res, timer) {
    return e => {
      this.log(res, timer)

      console.log(chalk.red.bold(e.message))
      console.log(chalk.grey(e.stack))

      this.reply(res, 500, e.message)
    }
  }

  respondWith (res, timer) {
    return async callback => {
      try {
        callback = await callback
        await this.pipe(callback, res)
      } catch (e) {
        this.error(res, timer)(e)
      } finally {
        this.log(res, timer)
      }
    }
  }

  async pipe (source, dest, timer) {
    const headers = source.headers.raw()
    const buffer = await source.buffer()

    // remove content-length and content-encoding
    // node-fetch decompresses compressed responses
    // so these headers are usually wrong
    delete headers['content-length']
    delete headers['content-encoding']

    dest.writeHead(source.status, source.statusText, headers)
    dest.write(buffer)
    dest.end()

    this.log(source, timer)
  }

  reply (res, code = 200, body = null) {
    if (!res.finished) {
      res.statusCode = code
      res.end(body)
      return true
    }

    return false
  }
}
