// @author.io/node-fetch is a modified version of @dollarshaveclub/node-fetch,
// updated to support Blob.arrayBuffer and Blob.text methods in the CFW emulator.
import fetch from '@author.io/node-fetch'
const { Request, Response, Headers } = fetch

async function fetchShim (...args) {
  let req = new Request(...args)

  // In Cloudflare Workers, host header
  // is ignored
  req.headers.delete('host')

  // In Cloudflare, no upstream requests
  // get streamed so read the entire body in and
  // create a new request with that body.
  // Techinically, this can be disabled by Cloudflare support
  // but it's enabled by default so we will use that as
  // our behavior.
  if (req.body) {
    const body = await req.arrayBuffer()
    req = new Request(req, {body: body})
  }

  const resp = await fetch(req)
  const shim = new ShimResponse(resp.body, resp)
  freezeHeaders(shim.headers)
  return shim
}

function freezeHeaders (headers) {
  Object.defineProperty(headers, 'set', {
    value: (url, status) => {
      throw new TypeError("Can't modify immutable headers")
    },
    writable: false
  })
  headers.frozen = true
}

class ShimResponse extends Response {
  static redirect (url, status) {
    return new ShimResponse('', {status: status || 302, headers: {Location: url}})
  }

  clone () {
    const cloned = super.clone()
    const res = new ShimResponse(cloned.body, {
      url: cloned.url,
      status: cloned.status,
      statusText: cloned.statusText,
      headers: cloned.headers,
      ok: cloned.ok
    })

    if (this.headers.frozen) {
      freezeHeaders(res.headers)
    }

    return res
  }
}

class ShimRequest extends Request {
  clone () {
    const cloned = super.clone()
    const req = new ShimRequest(cloned)
    if (this.headers.frozen) {
      freezeHeaders(req.headers)
    }
    if (this.cf) {
      Object.defineProperty(req, 'cf', {value: this.cf, writable: false, enumerable: false})
    }

    return req
  }
}

function bindCfProperty (req) {
  if (!req.cf) {
    Object.defineProperty(req, 'cf', {
      value: {
        tlsVersion: 'TLSv1.2',
        tlsCipher: 'ECDHE-ECDSA-CHACHA20-POLY1305',
        country: 'US',
        colo: 'LAX'
      },
      writable: false,
      enumerable: false
    })
  }
}

export {
  fetchShim as fetch,
  ShimRequest as Request,
  ShimResponse as Response,
  Headers,
  freezeHeaders,
  bindCfProperty
}
