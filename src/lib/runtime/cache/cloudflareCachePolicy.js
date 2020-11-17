import CachePolicy from 'http-cache-semantics'
import { URL } from 'url'

const REQ_METHOD = Symbol('REQ_METHOD')

export default class CloudflareCachePolicy extends CachePolicy {
  constructor (req, res, opts = {}) {
    const policyReq = CloudflareCachePolicy.cachePolicyRequestFromRequest(req, opts.ignoreMethod === true)
    const policyRes = CloudflareCachePolicy.cachePolicyResponseFromResponse(res)

    super(policyReq, policyRes, {shared: true, ...opts})

    this[REQ_METHOD] = policyReq.method
  }

  static cachePolicyRequestFromRequest (req, ignoreMethod) {
    return {
      url: new URL(req.url).pathname,
      method: ignoreMethod ? 'GET' : req.method,
      headers: Object.fromEntries(new Map(req.headers))
    }
  }

  static cachePolicyResponseFromResponse (res) {
    let headers = Object.fromEntries(new Map(res.headers))
    const cacheControl = headers['cache-control'] || ''
    const pruneSetCookie = cacheControl.toLowerCase().includes('private=set-cookie')

    if (pruneSetCookie) {
      // clean up the cache control directive so we don't confuse our parent class
      // if we didn't do this, it'd treat cache-control as being entirely private
      headers['cache-control'] = cacheControl.replace('private=set-cookie', '')
      delete headers['set-cookie']
    }

    return {
      status: res.status,
      headers
    }
  }

  storable () {
    const hasSetCookie = this.responseHeaders()['set-cookie'] !== undefined
    return !hasSetCookie && this[REQ_METHOD] === 'GET' && super.storable()
  }
}
