import fs from 'fs'
import path from 'path'
import vm from 'vm'
import chalk from 'chalk'
import chokidar from 'chokidar'
import { Table } from '@author.io/node-shell'
import { EventEmitter } from 'events'
import CFServer from './server.js'
import Configuration from './config.js'

let active = null

export default class CFWorker extends EventEmitter {
  #filepath
  #source
  #server
  #wasm
  #lastTime = null

  constructor (source, wasm) {
    super()

    if (vm.hasOwnProperty('measureMemory')) {
      process.env.MEMORY_MANAGEMENT_ENABLED = false

      vm.measureMemory({ mode: 'summary' })
        .then(result => {
          process.env.MEMORY_MANAGEMENT_ENABLED = true
          console.log(chalk.cyan('* Memory monitor activated'))
        })
        .catch(e => { })
    }

    this.#filepath = path.resolve(process.cwd(), source)

    if (!fs.existsSync(this.#filepath)) {
      console.log(chalk.red(`${chalk.bold(source)} does not exist or cannot be found.`))
      process.exit(1)
    }

    const info = this.loadWorker()

    this.#wasm = wasm
    this.#server = new CFServer(this.#source, this.#wasm)
    this.#server.filepath = this.#filepath
    this.#server.on('online', () => this.emit('online'))
    this.#server.on('offline', () => this.emit('offline'))

    active = this

    console.log('\n' + chalk.bold(`Worker: ${path.basename(this.#filepath)}`))
    console.log(chalk.grey.italic(`Last Update: ${info.mtime.toLocaleString()}`) + '\n')

    // Notify when WASM is active.
    if (Object.keys(wasm).length > 0) {
      console.log(chalk.cyan('* WebAssembly activated'))
    }
  }

  secrets (filepath, key = null) {
    this.#server.secrets(filepath, key)
  }

  set environment (value) {
    this.#server.config.use(value)
  }

  get environment () {
    return this.#server.config.environment
  }

  get environmentName () {
    return this.#server.config.name
  }

  get usingWranglerConfig () {
    return this.#server.config.active
  }

  get wranglerConfigFile () {
    if (!this.usingWranglerConfig) {
      return null
    }

    return this.#server.config.file
  }

  get variables () {
    return this.#server.config.variables
  }

  get host () {
    return this.#server.config.route
  }

  get localhost () {
    return this.#server.localhost
  }

  set configFile (value) {
    this.#server.configuration = new Configuration(value)
  }

  get cacheContent () {
    let cache = [['Expires', 'URI']]
    this.#server.cache.default.cache.dump().forEach(async item => {
      cache.push([new Date(item.e).toLocaleString(), item.k])
    })

    if (cache.length < 2) {
      return chalk.yellow.bold('Cache is empty.')
    }

    return chalk.blue.bold('  Current Cache:') + '\n\n' +(new Table(cache, null, ['35%'], 75, [2])).output//, null, null, 70, ['80%'], [4]).output
  }

  set cache (value) {
    this.#server.cachefile = value
  }

  clearCache () {
    this.#server.clearCache()
  }

  addStore () {
    this.#server.addStore(...arguments)
  }

  get namespaces () {
    return this.#server.namespaces
  }

  get persistKV () {
    return this.#server.persistKV
  }

  loadWorker () {
    this.#source = fs.readFileSync(this.#filepath).toString('utf-8')
    return fs.statSync(this.#filepath)
  }

  monitor () {
    const watcher = chokidar.watch(this.#filepath, { persistent: true })
  
    watcher.on('change', () => this.reload())

    watcher.on('unlink', filepath => {
      console.log(chalk.red.bold(` ==> ${path.basename(filename)} removed.`))
      process.exit(0)
    })

    console.log(chalk.cyan('* Automatic reload enabled'))
    console.log(chalk.grey('  - Monitoring ' + path.basename(this.#filepath)))

    if (this.#server.config.active) {
      const toml = chokidar.watch(this.#server.config.file, { persistent: true })

      toml.on('change', () => {
        const cfg = this.#server.config
        const old = {
          environment: cfg.environment,
          route: cfg.route,
          zone: cfg.zone,
          vars: cfg.variables 
        }
        
        cfg.read() // Re-reads the config
        
        if (old.environment) {
          cfg.use(old.environment)
        }

        if (old.route !== cfg.route) {
          console.log(chalk.yellow('* Updated route: ') + chalk.blue(`from ${old.route} to ${chalk.bold(cfg.route)}`))
        }

        if (old.zone !== cfg.zone) {
          console.log(chalk.yellow('* Updated zone: ') + chalk.blue(`from ${old.zone} to ${chalk.bold(cfg.zone)}`))
        }

        let oVars = new Map(Object.entries(old.vars))
        let nVars = new Map(Object.entries(cfg.variables))
        let match = oVars.size === nVars.size
        if (match) {
          for (let [name, val] of Object.entries(oVars)) {
            let x = nVars.get(name)
            if (x !== val) {
              match = false
              break
            }
          }
        }

        if (!match) {
          const varRows = Object.entries(cfg.variables)
          if (varRows.length > 0) {
            varRows.unshift(['Variable', 'Value'], ['----------', '----------'])
            const varTable = new Table(varRows, null, ['35%'], 60, [4])
            console.log(chalk.yellow(`* Applied Updated Environment:\n\n${chalk.grey(varTable.output)}\n`))
          }
        }
        
        this.reload(true)
      })
      
      toml.on('unlink', filepath => {
        console.log(chalk.red.bold(` ==> ${cfg.file} removed.`))
        process.exit(0)
      })

      console.log(chalk.grey('  - Monitoring ' + path.basename(this.#server.config.file)))
    }
  }

  start () {
    if (!this.#server) {
      this.#server = new CFServer(this.#source, this.#wasm)
    }

    if (!this.#server.online) {
      this.#server.start()
    }
  }

  reload (force = false) {
    const info = this.loadWorker()
    const time = info.mtime.toLocaleString()
    
    if (force || time !== this.#lastTime) {
      this.#lastTime = time

      if (this.#server) {
        this.#server.once('loaded', () => console.log(chalk.magenta(`Reloaded worker at ${new Date().toLocaleTimeString()}\n${chalk.grey.italic('> ' + path.basename(this.#filepath) + ' last modified at')} ${chalk.grey.italic(time)}` + '\n')))
        this.#server.worker = this.#source
      } else {
        this.start()
      }
    }
  }

  addHeader(name, value) {
    if (name && value && name.trim().length > 0 && value.trim().length > 0) {
      this.#server.addHeader(name, value)
      console.log(chalk.blue(`* Header: ${name.trim()}: ${value.trim()}`))
    } else {
      console.log(chalk.red.bold(`Failed to apply ${name}=${value} header.`))
    }
  }

  initializeKvStore (data = {}, namespace) {
    this.#server.applyKvStoreItems(...arguments)
  }
}
