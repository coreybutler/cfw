import path from 'path'
import fs from 'fs'
import chalk from 'chalk'
import crypto from 'crypto'

const algorithm = 'aes-256-cbc'
const iv = Buffer.from('................')

export default class Vault {
  #file
  #data = new Map()
  #encryptkey = 'admin'
  #secure = true

  constructor (source = './.cloudflare_secrets', key = null) {
    this.#file = path.resolve(source)
    
    while (this.#encryptkey.length < 32) { this.#encryptkey += '.' }

    this.read(false)

    Object.defineProperty(this, '___', {
      enumerable: false,
      get () { return this.#data }
    })
  }

  read (displayError = true) {
    if (fs.existsSync(this.#file)) {
      try {
        const raw = fs.readFileSync(this.#file, { encoding: 'utf8' })
        const content = JSON.parse(this.decrypt(raw))
        this.#data = new Map(Object.entries(content))
      } catch (e) {
        if (displayError) {
          console.log(chalk.red.bold(e.message))
        }
      }
    }
  }

  set insecure (value) {
    this.#secure = typeof value === 'boolean' ? !value : true
  }

  get (secret) {
    return this.#data.get(secret)
  }

  has (secret) {
    return this.#data.has(secret)
  }

  is (secret, value) {
    return this.#data.get(secret) === value
  }

  delete (secret) {
    if (this.#data.has(secret)) {
      this.#data.delete(secret)
      this.save()
    }
  }

  get secrets () {
    const result = new Map(this.#data)

    if (this.#secure) {
      result.forEach((value, key) => result.set(key, '[ENCRYPTED]'))
    }

    return result
  }

  set (name, value) {
    this.#data.set(name, value)
    this.save()
  }

  save () {
    const content = JSON.stringify(Object.fromEntries(this.#data))
    fs.writeFileSync(this.#file, this.encrypt(content))
  }

  set key (value) {
    while (value.length < 32) { value += '.' }

    this.#encryptkey = value
    this.save()
  }

  encrypt (content) {
    if (this.#encryptkey === null) {
      return content
    }

    let cipher = crypto.createCipheriv(algorithm, Buffer.from(this.#encryptkey), iv)
    let encrypted = cipher.update(content)
    encrypted = Buffer.concat([encrypted, cipher.final()])

    return encrypted.toString('hex')
  }

  decrypt (content) {
    if (this.#encryptkey === null) {
      return content
    }

    let decipher = crypto.createDecipheriv(algorithm, Buffer.from(this.#encryptkey), iv)
    let decrypted = decipher.update(Buffer.from(content, 'hex'))
    decrypted = Buffer.concat([decrypted, decipher.final()])
    
    return decrypted.toString()
  }
}
