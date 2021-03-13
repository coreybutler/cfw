import fs from 'fs'
import path from 'path'
import vm from 'vm'
import chalk from 'chalk'
import chokidar from 'chokidar'
import { Table } from '@author.io/node-shell'
import { EventEmitter } from 'events'
import CFServer from './server.js'
import Configuration from './config.js'
import os, { type } from 'os'
import webpack from 'webpack'
import { rollup } from 'rollup'
import { execSync } from 'child_process'

let active = null

export default class CFWorker extends EventEmitter {
  #filepath
  #source
  #sourcepath
  #server
  #wasm
  #lastTime = null
  #compiler = null
  #build = null

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
    this.#sourcepath = path.resolve(process.cwd(), source)

    if (!fs.existsSync(this.#filepath)) {
      console.log(chalk.red(`${chalk.bold(source)} does not exist or cannot be found.`))
      process.exit(1)
    }

    ;(async () => {

      this.#wasm = wasm
      this.#server = new CFServer(this.#source, this.#wasm)
      this.#server.filepath = this.#filepath
      this.#server.on('online', () => this.emit('online'))
      this.#server.on('offline', () => this.emit('offline'))

      const info = await this.build().catch(console.error)

      active = this

      // Notify when WASM is active.
      if (Object.keys(wasm).length > 0) {
        console.log(chalk.cyan('* WebAssembly activated'))
      }
    })()
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
    const cfg = new Configuration(value)
    this.#server.configuration = cfg
  }

  async build () {
    return new Promise(async (resolve, reject) => {
      const filepath = this.#sourcepath
      const pkgfile = path.join(path.dirname(filepath), 'package.json')

      if (fs.existsSync(pkgfile)) {
        const data = JSON.parse(fs.readFileSync(pkgfile).toString())

        if (data.type === "module" && this.#server && this.#server.config && this.#server.config.type) {
          const outdir = path.join(os.tmpdir(), 'cfw', data.name)
          fs.mkdirSync(outdir, { recursive: true })
          process.on('exit', () => fs.rmdirSync(outdir, { recursive: true }))

          switch (this.#server.config.type) {
            case 'webpack':
              // This code doesn't seem to work. Perhaps someone can figure out why and correct it.
              const cfg = {
                entry: path.join(path.dirname(pkgfile), path.dirname(data.main)),
                output: {
                  path: outdir,
                  filename: "index.js"
                },
                target: 'webworker'
              }

              console.log('Webpack Config:', cfg)
              const compiler = webpack(cfg)

              compiler.run((err, stats) => {
                compiler.close()
                if (err) {
                  console.error(err.stack || err)
                  if (err.details) {
                    console.error(err.details)
                  }
                  process.exit(1)
                }

                const info = stats.toJson()

                if (stats.hasErrors()) {
                  console.error(info.errors)
                  process.exit(1)
                }

                if (stats.hasWarnings()) {
                  console.warn(info.warnings)
                }

                console.log("<<<DONE>>>")
              })
              break

            case 'javascript':
              // Use rollup to bundle module
              const opts = {
                input: path.join(path.dirname(pkgfile), data.main)
              }

              const bundle = await rollup(opts)
              const { output } = await bundle.generate({ format: 'es' })

              let code = []
              for (const chunk of output) {
                if (chunk.type === 'chunk') {
                  code.push(chunk.code)
                }
              }

              this.#source = code.join('')
              break

            default:
              this.#source = fs.readFileSync(this.#filepath).toString('utf-8')
          }
        } else {
          this.#source = fs.readFileSync(this.#filepath).toString('utf-8')
          if (this.#source.match(/(import\s+{?.+}?\s+from\s+[\'\"][^\'\"]+[\'\"])/i)) {
            return reject(new Error(`An attempt to load an ES module was made, but the package.json does not identify a module type.`))
          }
        }
      } else {
        return reject(new Error(`Cannot find package.json at ${path.dirname(filepath)}`))
      }

      this.#server.worker = this.#source
      const stats = fs.statSync(this.#sourcepath)

      console.log('\n' + chalk.bold(`Worker: ${path.basename(this.#sourcepath)}`))
      console.log(chalk.grey.italic(`Last Update: ${stats.mtime.toLocaleString()}`) + '\n')

      resolve(stats)
    })
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
    this.build()
    // this.#source = fs.readFileSync(this.#filepath).toString('utf-8')
    return fs.statSync(this.#filepath)
  }

  monitor (cmd = null, source = null) {
    this.#build = cmd
    const root = source || path.dirname(this.#filepath)
    const watcher = chokidar.watch(root, { persistent: true })

    watcher.on('change', fp => {
      console.log(chalk.blue(`* Change Detected: ${fp}`))
      this.reload()
    })

    watcher.on('unlink', filepath => {
      console.log(chalk.red.bold(` ==> ${path.basename(filename)} removed.`))
      process.exit(0)
    })

    console.log(chalk.cyan('* Automatic reload enabled'))
    console.log(chalk.grey('  - Monitoring ' + root))

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
    if (this.#build !== null) {
      execSync(`npm run ${this.#build}`, { stdio: [0, 1, 2] })
    }
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

  // accepts a name attribute
  store () {
    return this.#server.store(...arguments)
  }
}
