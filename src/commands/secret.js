import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import { Command, Table } from '@author.io/node-shell'
import { execSync, spawn } from 'child_process'
import Configuration from '../lib/config.js'
import Vault from '../lib/secrets.js'

const run = cmd => execSync(cmd).toString()

let VAULT = null

const cmd = new Command({
  name: 'secret',
  description: 'View and manage secrets. This wraps the "wrangler secret" command to make secrets available in the local runtime.',
  commonflags: {
    file: {
      alias: 'f',
      description: 'The file where the secrets are stored locally. Stored in plain text.',
      default: '.cloudflare_secrets',
      type: 'string'
    },
    environment: {
      alias: 'e',
      description: 'Environment to use',
      type: String
    },
    encrypt: {
      alias: ['key'],
      description: 'A custom encryption key for saving secrets.',
      type: String
    }
  },
  use: [(meta, next) => {
    VAULT = new Vault(meta.flag('file'), meta.flag('encrypt'))
    next()
  }],
  commands: [{
    name: 'delete',
    alias: 'rm',
    description: 'Delete a secret variable from a script',
    arguments: 'VAR_NAME',
    handler (meta) {
      if (!meta.flag('VAR_NAME')) {
        console.log(meta.command.help)
        console.log('\n' + chalk.red.bold('VAR_NAME is required.') + '\n')
        return
      }

      let v = meta.flag('VAR_NAME')
      let wrangler = spawn(`wrangler secret delete${meta.flag('environment') ? ' -e ' + meta.flag('environment') : ''} ${v}`, { shell: true })

      wrangler.on('close', code => VAULT.delete(v))
      wrangler.stdout.on('data', c => console.log(chalk.grey(c.toString())))
      wrangler.stdin.setEncoding('utf-8')
      wrangler.stdin.write('y')
      wrangler.stdin.end()
    }
  }, {
    name: 'list',
    alias: 'ls',
    flags: {
      insecure: {
        description: 'Display values of secrets in plain text.',
        type: 'boolean'
      }
    },
    describeDefault: false,
    description: 'List all secrets for a script',
    handler (meta) {
      try {
        let result = run(`wrangler secret list ${meta.flag('environment') ? '-e ' + meta.flag('environment') : ''}`)
        let data = JSON.parse(result.trim()).map(i => [i.name, i.type])

        VAULT.insecure = meta.flag('insecure')
        let secrets = VAULT.secrets
        let keys = new Set()
        const remoteonly = new Set()

        data.forEach((kv, i) => {
          keys.add(kv[0])
          if (secrets.has(kv[0])) {
            kv[1] = secrets.get(kv[0])
          } else {
            kv[1] = `*${kv[1]}`
            remoteonly.add(kv[0])
          }
        })

        secrets.forEach((value, key) => {
          if (!keys.has(key)) {
            data.push([key, meta.flag('insecure') ? value : '[ENCRYPTED]'])
          }
        })

        if (Object.keys(data).length === 0) {
          return console.log(chalk.yellow.bold('No secrets available.'))
        }

        console.log('\n' + chalk.blue.bold(`  Secrets ${meta.flag('environment') ? '(' + meta.flag('environment') + ')' : ''}`))
        data.unshift(['Variable', 'Value'], ['--------', '-----'])

        let table = new Table(data, null, ['30%'], 65, [2, 0, 1, 1]).output

        console.log(chalk.grey(table))

        if (remoteonly.size > 0) {
          const out = [
            ['The following secrets were configured outside of this runtime:'],
            [''],
            [' > ' + Array.from(remoteonly).join(', ')],
            [''],
            ['Only secrets set with this tool are available in the local testing runtime. Consider resetting these (i.e. ' + chalk.bold(meta.shell.name + ' secret put') + ') if you need them.']
          ]

          console.log(chalk.yellow(new Table(out, null, null, 80, [2, 0, 1, 1]).output))
        }
      } catch (e) {
        if (!meta.flag('environment')) {
          let cfg = new Configuration()
          if (cfg.environments.length > 0) {
            console.log(chalk.yellow(`Did you mean to specify an environment?\n\n${cfg.environments.map(i => '  ' + meta.command.commandroot + ' -e ' + i).join('\n')}`))
          }
        }
      }
    }
  }, {
    name: 'put',
    arguments: 'VAR_NAME value',
    description: 'Create or update a secret variable for a script',
    handler (meta) {
      if (!meta.flag('VAR_NAME')) {
        console.log(meta.command.help)
        console.log('\n' + chalk.red.bold('VAR_NAME is required.') + '\n')
        return
      }

      if (!meta.flag('value')) {
        console.log(meta.command.help)
        console.log('\n' + chalk.red.bold('value is required.') + '\n')
        return
      }

      // let result = run(`wrangler secret put ${meta.input} ${meta.flag('VAR_NAME')}`)
      const cmd = `wrangler secret put ${meta.flag('environment') ? '-e ' + meta.flag('environment') : ''} ${meta.flag('VAR_NAME')}`

      console.log('\n' + chalk.grey(cmd) + '\n')

      let wrangler = spawn(cmd, {
        shell: true
      })

      wrangler.on('close', code => VAULT.set(meta.flag('VAR_NAME'), meta.flag('value')))
      wrangler.stdout.on('data', c => console.log(chalk.grey(c.toString())))
      wrangler.stdin.setEncoding('utf-8')
      wrangler.stdin.write(meta.flag('value'))
      wrangler.stdin.end()
    }
  }]
})

export { cmd as default }
