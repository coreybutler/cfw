import fs from 'fs'
import path from 'path'

export default class WASM {
  static async create (cfg) {
    const bindings = {}

    for (let item in cfg) {
      bindings[item] = await WASM.load(cfg[item])
    }

    return bindings
  }

  static async load (filepath) {
    return WASM.buffer(fs.readFileSync(path.resolve(process.cwd(), filepath)))
  }

  static async buffer (buffer) {
    return WebAssembly.compile(new Uint8Array(buffer))
  }

  static parse (arg) {
    arg = arg.split('=')

    if (arg.length !== 2) {
      throw new Error('Invalid wasm flag format. Expected format of [variable=path]')
    }

    return arg
  }
}
