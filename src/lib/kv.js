import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import streams from 'web-streams-polyfill'

export default class KeyValueStore {
  #path = null
  #data = new Map()
  #store
  #namespace = 'Unknown'
  #persistent = false
  #debug = false
  #save = () => {
    if (this.#persistent) {
      if (this.#namespace.trim().toLowerCase() !== 'unknown') {
        this.#data.set('__KV_NAMESPACE__', this.namespace)
      }

      fs.writeFileSync(this.#path, JSON.stringify(Object.fromEntries(this.#data), null, 2))
      
      this.#debug && console.log(chalk.cyan(`* Saved changes in ${this.#namespace} KV namespace to ${path.basename(this.#path)}`))
    }
  }

  constructor (filepath = null, namespace) {
    // Initialize a proxy to automatically persist KV data
    let data = this.#data
    const save = this.#save

    this.#store = new Proxy({}, {
      get (obj, prop) { return data.get(prop) },
      set (obj, prop, value) {
        data.set(prop, value)
        save()
        return true
      },
      deleteProperty (obj, prop) {
        if (!data.has(prop)) {
          throw new Error('HTTP DELETE request failed: 404 Not Found')
        }

        data.delete(prop)
        save()

        return true
      },
      has: function (obj, prop) {
        return data.has(prop)
      }
    })

    // Specify a file to persist KV data.
    this.file = filepath
  }

  get debug () {
    return this.#debug
  }

  set debug (value) {
    if (value instanceof 'boolean') {
      if (value !== this.#debug) {
        this.#debug = value
      }
    }
  }

  get namespace () {
    return this.#namespace
  }

  set namespace (value) {
    if (this.#namespace !== value) {
      this.#namespace = value || 'unknown'
      if (this.#namespace.toLowerCase() !== 'defaultkv' && value !== 'unknown') {
        if (this.#persistent) {
          console.log(chalk.cyan(`* Persisting ${this.namespace} KV namespace in ${path.basename(this.#path)}`))
        }
      }
    }
  }

  get persistent () {
    return this.#persistent
  }

  set file (filepath) {
    const wasPersistent = this.#persistent

    // When a path is set enable the persistence functionality
    this.#persistent = filepath && filepath.length > 0

    if (this.#persistent) {
      this.#path = filepath

      // Check if the KV store file exists
      if (fs.existsSync(path.resolve(this.#path))) {
        this.#path = path.resolve(this.#path)
      } else {
        this.#path = path.join(process.cwd(), filepath)
      }

      if (!fs.existsSync(this.#path)) {
        if (path.extname(this.#path).trim().toLowerCase() === '.json') {
          fs.mkdirSync(path.dirname(this.#path), { recursive: true })
        } else {
          fs.mkdirSync(this.#path, { recursive: true })
          this.#path = path.join(this.#path, `${path.basename(process.cwd()).trim().toLowerCase().replace(/[^a-z0-9]/gi, '-')}-kv-store.json`)
        }

        fs.writeFileSync(this.#path, '{}', { encoding: 'utf8' })
        console.log(chalk.grey.italic(`Path not found. Automatically created "${this.#path}".`))
      } else {
        // Read from the KV store file and parse as JSON
        let data = JSON.parse(fs.readFileSync(this.#path, { encoding: 'utf8' }))
        if (data.hasOwnProperty('__KV_NAMESPACE__')) {
          this.namespace = data.__KV_NAMESPACE__
          delete data.__KV_NAMESPACE__
        }

        // Bind the data from the KV store file to the store
        let save = false
        for (let [key, obj] of Object.entries(data)) {
          let { value } = obj
          delete obj.value
          if (!this.expired(obj)) {
            this.put(key, Buffer.from(value), obj, true)
          } else {
            save = true
          }
        }

        if (this.#data.size > 0) {
          console.log(chalk.grey(`  Loaded ${this.#data.size === 0 ? 'no' : this.#data.size} keypair${this.#data.size !== 1 ? 's' : ''} from ${path.basename(this.#path)} into ${this.namespace} KV namespace.`))
        }

        save && this.#save()
      }
    } else if (wasPersistent) {
      console.log(chalk.grey(`No longer saving KV ${this.namespace} values.`))
    }
  }

  put (key, value, opt = {}, failSilent = false) {
    const ttl = this.ttl(opt)
    
    if (ttl === 0) {
      if (failSilent) {
        return 
      }

      return Promise.reject('Unacceptable Expiration. Must be at least 60 seconds in the future.')
    }

    const data = {
      value: Buffer.from(value)
    }
    
    if (ttl !== null) {
      data.expiration = ttl + new Date().getTime()
      
      setTimeout(() => {
        this.delete(key)
        console.log(chalk.grey(`::: ${this.namespace}.${key} expired.`))
      }, ttl)
    }
    
    this.#store[key] = data
    
    return Promise.resolve(undefined)
  }

  expired (obj) {
    const ttl = this.ttl(obj)
    return ttl !== null || ttl === 0
  }

  ttl (obj = {}) {
    if (typeof obj !== 'object') {
      return null
    }

    // CloudFlare only supports expirations at least
    // 60 seconds from "now"
    const now = new Date().getTime() + 60000
    let ttl = 0

    if (obj.hasOwnProperty('expiration')) {
      ttl = obj.expiration - now
      return ttl < 0 ? 0 : ttl
    } else if (obj.hasOwnProperty('expirationTtl')) {
      return obj.expirationTtl * 1000
    }

    return null
  }

  get (key, type = 'text') {
    const validTypes = ['text', 'arrayBuffer', 'json', 'stream']
    if (!validTypes.includes(type)) {
      throw new TypeError('Unknown response type. Possible types are "text", "arrayBuffer", "json", and "stream".')
    }

    const data = this.#store[key]
    if (data === undefined) {
      return Promise.resolve(null)
    }

    const { value } = data
    switch (type) {
      case 'text':
        return Promise.resolve(value.toString())
      case 'arrayBuffer':
        return Promise.resolve(Uint8Array.from(value).buffer)
      case 'json':
        return Promise.resolve(JSON.parse(value.toString()))
      case 'stream':
        const { readable, writable } = new streams.TransformStream()
        const writer = writable.getWriter()
        writer.write(Uint8Array.from(value)).then(() => writer.close())
        return Promise.resolve(readable)
    }
  }

  delete (key) {
    delete this.#store[key]
    return Promise.resolve(undefined)
  }

  list (cfg = { prefix: null, limit: 1000, cursor: 0 }) {
    cfg.limit = cfg.limit <= 0 ? 1000 : cfg.limit
    cfg.cursor = cfg.hasOwnProperty('cursor') ? cfg.cursor : 0
    const prefix = cfg.prefix || ''

    let dataset = (
      prefix.length > 0 
        ? Array.from(this.#data.keys())
          .filter(key => key.indexOf(cfg.prefix) === 0)
        : Array.from(this.#data.keys())
    ).sort((a, b) => {
      // Lexigraphic sorting (alphabetical)
      if (a.name > b.name) {
        return 1
      } else if (b.name > a.name) {
        return -1
      }
      return 0
    })
  
    const totalSize = dataset.length
    dataset = dataset.slice(cfg.cursor, cfg.cursor + cfg.limit)
    const list_complete = (dataset.length + cfg.cursor) >= totalSize
    const cursor = list_complete ? null : dataset.length + cfg.cursor
    
    return Promise.resolve({
      keys: dataset.map(name => { 
        const obj = { name }
        const item = this.#data.get(name)
        if (item.hasOwnProperty('expiration')) {
          obj.expiration = item.expiration
        }
        return obj
      }),
      list_complete,
      cursor
    })
  }

  // Apply bulk data
  apply (kvdata = {}) {
    let empty = true
    const now = new Date().getTime()

    for (let [key, data] of Object.entries(kvdata)) {
      let include = true
      let expire = {}

      if (data.hasOwnProperty('expiration')) {
        if (data.expiration >= now) {
          include = false
        } else {
          expire.expiration = data.expiration
        }
      }
      
      if (include) {
        this.put(key, data, expire, true)
        if (empty) {
          empty = false
        }
      }
    }

    !empty && this.#save()
  }
}