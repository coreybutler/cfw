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
  name: 'publish',
  alias: 'pub',
  description: 'Publish your worker.',
  flags: {
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
    secrets: {
      alias: 's',
      description: 'Auto-update secrets on CloudFlare.',
      type: Boolean,
      default: true
    },
    encrypt: {
      aliases: ['key'],
      description: 'A custom encryption key for decrypting secrets.',
      type: String
    }
  },
  use: [(meta, next) => {
    VAULT = new Vault(meta.flag('file'), meta.flag('encrypt'))
    next()
  }],
  handler (meta) {
    if (meta.flag('environment') === null) {
      console.log(this.help + '\n')
      console.log(chalk.yellow.bold(chalk.grey('________________________') + '\n\nNo environment specified'))

      let cfg = new Configuration()
      let env = cfg.environments

      if (cfg.active && env.length > 0) {
        console.log('\nDid you mean to specify one of these environments?\n')
        console.log(cfg.environments.map(i => `  - ${chalk.bold(i)}`).join('\n') + '\n')
      }

      console.log(chalk.yellow('To specify ' + chalk.bold('all') + ' environments, pass the ' + chalk.italic('-e') + ' flag with no value.'))

      return
    }

    const log = function () {
      for (let a of arguments) {
        console.log(chalk.grey(a))
      }
    }

    let secretActions = []
    if (meta.flag('secrets') === true) {
      log('Publishing secrets...')
      // Set this so the vault returns the appropriate values instead of "[ENCRYPTED]" for every value.
      VAULT.insecure = true
      const secrets = VAULT.secrets
      VAULT.insecure = false

      secrets.forEach((value, name) => {
        log(`Publishing ${name}...`)
        secretActions.push(meta.command.shell.exec(`secret put${meta.flag('environment') ? ' -e ' + (meta.flag('environment') || '') : ''} ${name} ${value}`))
      })
    }

    Promise.all(secretActions).then(() => {
      setTimeout(() => {
        const cmd = `wrangler publish${typeof meta.flag('environment') === 'string' ? ' -e ' + meta.flag('environment') : ''} --verbose`
        log(execSync(cmd, { shell: true }))
      }, 10)
    }).catch(e => console.log(chalk.red.bold(e.message)))
  }
})

export { cmd as default }
