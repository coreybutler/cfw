import chalk from 'chalk'
import URL from 'url'
import bodyParser from 'body-parser'

const mw = bodyParser.json()

export default class Router {
  #worker

  constructor (server) {
    this.#worker = server
    console.log(chalk.cyan('* API emulator activated'))
  }

  async route (req, res) {
    res.statusCode = 501
    return res.end('Not Implemented')

    mw(req, res)
    req.URL = new URL(req.url, `http://${req.headers.host}`)
    let route = /^\/api\/(\w+)\/?/i.match(req.url) || ['']

    switch (route.pop().trim().toLowerCase()) {
      case 'storage':
        return await this.kv(req, res, stores)
      default:
        return this.NotFound(res)
    }
  }

  async kvlist (req, res) {
    const params = {
      page: req.URL.searchParams.get('page') || 1,
      per_page: req.URL.searchParams.get('per_page') || 20,
      order: req.URL.searchParams.get('order'),
      direction: req.URL.searchParams.get('direction')
    }

    params.page = params.page < 1 ? 1 : params.page
    params.per_page = params.per_page > 20 ? 20 : (params.per_page < 5 ? 5 : params.per_page)
    params.order = (['id', 'title']).indexOf(params.order.toLowerCase()) < 0 ? null : params.order.toLowerCase()
    params.direction = (['asc', 'desc']).indexOf(params.direction.toLowerCase()) < 0 ? null : params.direction.toLowerCase()

    let result = Array.from(this.#worker.stores.keys()).slice((params.page * params.per_page) - params.per_page, params.per_page)

    if (params.order !== null) {
      result.sort((a, b) => {
        if (a[params.order] > b[params.order]) {
          return 1
        }

        return -1
      })
    }

    if (params.direction !== null) {
      result.sort((a, b) => {
        if (a[params.order] > b[params.order]) {
          return params.direction === 'asc' ? 1 : -1
        }

        return params.direction === 'asc' ? -1 : 1
      })
    }

    return this.json(res, {
      success: true,
      errors: [],
      messages: [],
      result: result.map(store => {
        // const s = this.#worker.store(store)
        return {
          id: store,
          title: store,
          supports_url_encoding: true
        }
      })
    })
  }

  async kvcreate (req, res) {
    if (!req.body || !res.body.hasOwnProperty('title')) {
      return this.badrequest(res, 'Missing request body.')
    }


  }

  async kv (req, res) {
    const route = /^^\/api\/storage\/kv\/namespaces\/(\w+)\/(\w+)\/?(\w+)?/i.match(req.url) || ['']

    if (route === null) {
      return this.NotFound(res)
    }

    const store = route[1]
    const op = route[2]
    const key = route[3]

    // Support list op (no-op)
    if (store === undefined && op === undefined && key === undefined) {
      switch (req.method) {
        case 'GET':
          return await this.kvlist(req, res, stores)
        case 'POST':
          return await this.kvcreate(req, res, stores)
        default:
          return this.NotFound()
      }
    }

    // Assure store exists
    if (!stores.has(store)) {
      return this.NotFound(res, `"${store}" Store Not Found`)
    }

    switch (op.trim().toLowerCase()) {
      case '':
        break
    }
  }

  NotFound (res, m = 'Not Found') {
    res.statusCode = 404
    res.end(m)
  }

  badrequest (res, m = 'Invalid request.') {
    res.statusCode = 400
    res.end(m)
  }

  json (res, data, status = 200) {
    res.statusCode = status
    res.end(JSON.stringify(data, null, 2))
  }
}
