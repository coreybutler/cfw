#!/usr/bin/env NODE_OPTIONS='--require=./suppress.cjs' node --experimental-modules -r source-map-support/register
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Shell } from '@author.io/node-shell'
import run from './commands/run.js'
import secret from './commands/secret.js'
import publish from './commands/publish.js'
import chalk from 'chalk'

globalThis.__dirname = path.dirname(fileURLToPath(import.meta.url))

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json')))

process.on('uncaughtException', e => {
  console.log(chalk.red(e))
  process.exit(1)
})

const shell = new Shell({
  name: Object.keys(pkg.bin)[0],
  description: pkg.description,
  version: pkg.version,
  commands: [
    run,
    secret,
    publish
  ]
})

shell.exec(process.argv.slice(2).join(' ').trim()).catch(e => console.log(e.message || e))