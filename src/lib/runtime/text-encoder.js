import util from 'util'

class TextDecoder extends util.TextDecoder {
  constructor () {
    if (arguments.length > 0 && arguments[0] !== 'utf-8') {
      throw new RangeError('TextDecoder only supports utf-8 encoding')
    }

    super(...arguments)
  }
}

const enc = util.TextEncoder

export { TextDecoder, enc as TextEncoder }
