import Crypto from 'crypto'

const crypto = Crypto.webcrypto

export { crypto as default }
// import Crypto from 'node-webcrypto-ossl'

// const crypto = new Crypto.Crypto()
// const subtleDigest = crypto.subtle.digest

// crypto.subtle.digest = function digest (algorithm, data) {
//   if (typeof algorithm === 'string' && algorithm.toLowerCase() === 'md5') {
//     const hash = require('crypto')
//       .createHash('md5')
//       .update(data)
//       .digest()

//     return hash.buffer
//   }

//   return subtleDigest.apply(this, arguments)
// }

// export { crypto as default }
