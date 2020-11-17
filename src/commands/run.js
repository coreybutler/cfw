import fs, { fstatSync } from 'fs'
import path from 'path'
import http from 'http'
import bodyParser from 'body-parser'
import chalk from 'chalk'
import readline from 'readline'
import { Server } from 'http'
import CFWorker from '../lib/worker.js'
import WASM from '../lib/wasm.js'
import { Command, Table } from '@author.io/node-shell'
import chokidar from 'chokidar'

const cmd = new Command({
  name: 'run',
  description: 'Run a CloudFlare worker.',
  arguments: 'worker.js',
  flags: {
    port: {
      alias: 'p',
      type: 'number',
      required: true,
      default: 8787,
      description: 'Port'
    },
    keyvalue: {
      aliases: ['kv', 's'],
      allowMultipleValues: true,
      description: 'Set a KV value. Ex: -kv store.key=value. If "store" is unspecified, a new one called "defaultkv" will be created.'
    },
    store: {
      alias: 'kvs',
      type: String,
      allowMultipleValues: true,
      description: 'Persist KV values in this directory/file.'
    },
    wasm: {
      alias: 'w',
      allowMultipleValues: true,
      description: 'Add a web assembly file to the worker runtime. Ex: cfw run -w mywasm=my.wasm worker.js '
    },
    cache: {
      alias: 'c',
      description: 'Specify a file or directory where the cache will be saved.',
      type: String,
      default: './.cloudflare_worker_cache'
    },
    reload: {
      alias: 'r',
      type: Boolean,
      description: 'Automatically reload when files change.'
    },
    header: {
      alias: 'h',
      description: 'Apply a header to all requests. Ex: -h CF-IPCountry:US',
      allowMultipleValues: true
    },
    env: {
      alias: 'e',
      description: 'Apply an environment variable to the runtime.',
      allowMultipleValues: true
    },
    environment: {
      description: 'The Wrangler environment to load.'
    },
    toml: {
      alias: 'f',
      description: 'Path to the wrangler.toml configuration file.',
      default: './'
    },
    secrets: {
      description: 'The path to a file where secrets are stored (optional)',
      type: 'string'
    },
    encrypt: {
      alias: 'enc',
      description: 'A custom encryption key for accessing secrets.',
      type: 'string'
    }
  },
  async handler (meta) {
    // Identify worker
    if (meta.flag('worker.js') === undefined) {
      console.log(meta.help.default + '\n')
      console.log(chalk.yellow.bold('A worker file is required.'))

      const jsFiles = fs.readdirSync(path.join(process.cwd())).filter(i => path.extname(i) === '.js')
      if (jsFiles.length > 0) {
        const prefix = (meta.command.commandroot + ' ' + meta.input + ' ').trim()
        if (jsFiles.length === 1) {
          console.log(chalk.yellow(`Did you mean ${chalk.magenta((prefix + ' ' + jsFiles[0])).trim()}?`))
        } else {
          console.log('\n' + chalk.yellow('Perhaps you meant to run one of these?') + '\n')
          jsFiles.forEach(js => console.log('  ' + chalk.yellow(`- ${chalk.magenta(prefix + ' ' + js)}`)))
          console.log('')
        }
      }

      process.exit(1)
    }

    // Identify the port
    process.env.PORT = meta.flag('port')

    // Load WASM files
    const bindings = {}
    for (let arg in meta.flag('wasm')) {
      arg = WASM.parse(arg)
      bindings[wasm[0]] = wasm[1]
    }

    const wasm = await WASM.create(bindings).catch(e => console.log(e) && process.exit(1))
    const source = meta.flag(0)
    const worker = new CFWorker(source, wasm)

    worker.cache = meta.flag('cache')

    if (meta.flag('secrets')) {
      worker.secrets(meta.flag('secrets'), meta.flag('encrypt'))
    }

    // Identify the Wrangler file and load config if possible.
    worker.configFile = meta.flag('toml')

    // Support responsive reloading.
    if (meta.flag('reload')) {
      worker.monitor()
    }

    // Support environment variables
    worker.environment = meta.flag('environment')
    if (worker.usingWranglerConfig) {
      console.log(chalk.cyan(`* Recognized Wrangler Config: ${chalk.bold(worker.environment ? worker.environment : 'default')}`))
      if (worker.environmentName.toLowerCase() !== 'default') {
        console.log(chalk.grey(`  ${worker.environmentName}`))
      }
      console.log('  ' + chalk.grey.italic(worker.wranglerConfigFile.replace(process.cwd(), '.')))
    }
    console.log(chalk.blue(`\n* Host: ${worker.host}\n`))

    const displayEnvironment = () => {
      const varRows = Object.entries(worker.variables)
      if (varRows.length > 0) {
        varRows.unshift(['Variable', 'Value'], ['----------', '----------'])
        const varTable = new Table(varRows, null, ['35%'], 60, [2])
        console.log(chalk.blue(`* Applied Environment:\n\n${chalk.grey(varTable.output)}\n`))
      }
    }

    displayEnvironment()

    // Support Hard-Coded Headers
    meta.flag('header').forEach(header => worker.addHeader.apply(worker, header.split(/:|=/)))

    // Apply KV Persistence
    meta.flag('store').forEach(store => {
      worker.addStore(...store.split(/:|=/i))
      // worker.addStore.apply(worker, store.split(/:|=/i)
    })

    // Apply KV Values
    const kvitems = meta.flag('keyvalue')
    if (kvitems.length > 0) {
      const kvrows = { defaultkv: [] }

      kvitems.forEach(item => {
        item = item.split(/:|=/)
        const location = item[0].split('.')
        const store = location.length > 1 ? location[0] : 'defaultkv'
        kvrows[store] = kvrows[store] || []
        kvrows[store].push([location.pop(), item.length > 1 ? item[1] : ''])
      })

      for (let [store, rows] of Object.entries(kvrows)) {
        if (rows.length > 0) {
          worker.initializeKvStore(Object.fromEntries(new Map(rows)), store)

          rows.unshift(['----------', '----------'])
          rows.unshift(['Key', 'Value'])

          const table = new Table(rows, null, ['35%'], 40, [4, 0, 2, 1])
          console.log(chalk.blue(`* Applied ${chalk.bold(store)} store values:${chalk.grey(table.output)}`))
        }
      }
    }

    let activeDefaultUrl

    const help = () => {
      console.log(chalk.bold('\n* Features:\n'))
      console.log(chalk.grey(`  ${chalk.bold('Ctrl+c')} = quit`))
      console.log(chalk.grey(`  ${chalk.bold('Ctrl+h')} = help`))
      console.log(chalk.grey(`  ${chalk.bold('Ctrl+r')} = reload`))
      console.log(chalk.grey(`  ${chalk.bold('Ctrl+a')} = view active cache`))
      console.log(chalk.grey(`  ${chalk.bold('Ctrl+n')} = nuke active cache (destructive)`))
      console.log(chalk.grey(`  ${chalk.bold('Ctrl+e')} = view environment variables`))
      console.log(chalk.grey(`  ${chalk.bold('Ctrl+g')} = GET http://${activeDefaultUrl}`))
      console.log(chalk.grey(`  ${chalk.bold('Ctrl+p')} = Preferences`))
      console.log('')
    }

    readline.emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    process.stdin.on('keypress', (str, key) => {
      if (key.sequence === '?' || (key.name === 'backspace' && key.sequence === '\b')) {
        return help()
      }

      if (key.ctrl) {
        switch (key.name) {
          case 'p':
            console.log(new Table([
              [chalk.bold('Preferences')],
              ['This tool will look for a file called .cfw_prefs, a JSON file containing the preferred URL to submit default HTTP GET requests to (the ctrl+g command).']
            ], null, null, 70, [2, 0, 0, 1]).output)

            if (!fs.existsSync(path.resolve('.cfw_prefs'))) {
              fs.writeFileSync(path.resolve('.cfw_prefs'), JSON.stringify({ url: activeDefaultUrl }))
              console.log('\n' + chalk.bold.yellow(`  * This file was just created for you.`) + '\n')
            }
            return
          case 'r':
            return worker.reload(true)
          case 'z':
          case 'c':
            return process.exit(0)
          case 'a':
            return console.log(worker.cacheContent)
          case 'h':
            return help()
          case 'e':
            return displayEnvironment()
          case 'n':
            return worker.clearCache()
          case 'g':
            const req = http.get(`http://${activeDefaultUrl}`, res => {
              let headers = new Table([['Header', 'Value'], ['------', '-----']].concat(Object.entries(res.headers)), null, ['40%'], 75, [4]).output
              let body = ''

              res.on('data', chunk => body += chunk.toString())
              res.on('end', () => {
                console.log('    ---------------------------')
                console.log(chalk.bold('    Status: ' + `${res.statusCode} (${res.statusMessage})`))
                console.log('    ---------------------------\n')
                console.log(chalk.grey(headers.replace('Header', chalk.bold('Header'))) + '\n')
                if (body.length > 0) {
                  console.log(chalk.bold('    Response Body:\n'))
                  console.log(chalk.grey(body.split('\n').map(i => `    ${i}`).join('\n')))
                } else {
                  console.log(chalk.bold('    Response Body: None'))
                }
                console.log('')
              // console.log('---------------------------\n')
              })
            })
        }
      }
    })

    worker.once('online', () => {
      activeDefaultUrl = worker.localhost
      if (fs.existsSync(path.resolve('.cfw_prefs'))) {
        try {
          activeDefaultUrl = JSON.parse(fs.readFileSync(path.resolve('.cfw_prefs'), { encoding: 'utf8' })).url
          const m = chokidar.watch(path.resolve('.cfw_prefs'), { persistent: true })
          m.on('change', () => activeDefaultUrl = JSON.parse(fs.readFileSync(path.resolve('.cfw_prefs'), { encoding: 'utf8' })).url)
        } catch (e) {
          console.log(chalk.red.bold(e.message))
        }
      }
      // Delay this a tiny bit so the worker messaging is output first.
      setTimeout(() => help(), 50)
    })

    worker.start()
  }
})

export { cmd as default }
