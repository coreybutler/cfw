// Represents the config, as defined by a wrangler.toml file.
import TOML from '@iarna/toml'
import fs from 'fs'
import path from 'path'
import { runInThisContext } from 'vm'

export default class Configuration {
  #file = null
  #data
  #env = null
  #active = false
  #host = 'example.com/*'
  #variables = {}
  #zone
  #name = 'default'

  constructor (filepath = './', env = null) {
    filepath = filepath || './'

    if (fs.existsSync(path.resolve(filepath))) {
      this.#file = path.resolve(filepath)
    } else {
      filepath = path.join(process.cwd(), filepath)
    }

    if (!fs.existsSync(filepath)) {
      return
    }

    if (fs.statSync(filepath).isDirectory()) {
      filepath = path.join(filepath, 'wrangler.toml')
    }

    if (!fs.existsSync(filepath)) {
      return
    }

    this.#file = path.resolve(filepath)
    this.read()

    if (env !== null) {
      this.use(env)
    }

    this.#active = true
  }

  get active () { return this.#active }

  get file () {
    return this.#file
  }

  get environment () {
    return this.#env
  }

  get environments () {
    return Object.keys(this.#data.env)
  }

  read () {
    const content = fs.readFileSync(this.#file, { encoding: 'utf8' })

    try {
      this.#data = TOML.parse(content)
    } catch (e) {
      console.error(e)
    }
  }

  use (env) {
    if (env === null) {
      this.#env = null
      return
    }

    const d = this.#data

    if (d.env.hasOwnProperty(env)) {
      this.#env = env

      if (d.env && d.env[env]) {
        const e = d.env[env]

        e.route && (this.#host = e.route)
        e.vars && (this.#variables = e.vars)
        e.zone_id && (this.#zone = e.zone_id)
        e.name && (this.#name = e.name)
      } else {
        d.route && (this.#host = d.route)
        d.zone_id && (this.#zone = d.zone_id)
        d.name && (this.#name = d.name)
      }
    } else {
      console.error(`Unrecognized environment: "${env}"`)
    }
  }

  get name () {
    return this.#name
  }

  get variables () {
    return this.#variables
  }

  get route () {
    return this.#host
  }

  get zone () {
    return this.#zone
  }

  get type () {
    return this.#data.type
  }

  get data () {
    return this.#data
  }
}