export default class FetchEvent {
  constructor (type, init) {
    this.request = init.request
  }

  respondWith () {
    throw new Error('unimplemented')
  }

  waitUntil () {
    throw new Error('unimplemented')
  }

  passThroughOnException () {} // Not sure why this no-op exists
}
