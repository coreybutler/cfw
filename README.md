# Cloudflare Worker Emulator

This emulator runs most Cloudflare workers locally, in an isolated environment. When work is complete, it can be published to Cloudflare using the publish subcommand. The tool extends the Wrangler tool provided by Cloudflare and was re-engineered from the original work created by Dollar Shave Club.

## Installation

`npm i -g @author.io/cfw`

## Usage

```bash
cfw [COMMAND]

  Emulates the Cloudflare worker environment.

Commands:

  run                 Run a Cloudflare worker.
  secret              View and manage secrets. This wraps the "wrangler secret"
                      command to make secrets available in the local runtime.
  publish|pub         Publish your worker.
```

**run**

```bash
cfw run [FLAGS] <worker.js>

  Run a Cloudflare worker.

Flags:

  --port          [-p]        Required. Port (Default: 8787)
  --keyvalue      [-kv, -s]   Set a KV value. Ex: -kv store.key=value. If "store"
                              is unspecified, a new one called "defaultkv" will
                              be created. Can be used multiple times.
  --store         [-kvs]      Persist KV values in this directory/file. Can be
                              used multiple times.
  --wasm          [-w]        Add a web assembly file to the worker runtime. Ex:
                              cfw run -w mywasm=my.wasm worker.js  Can be used
                              multiple times.
  --cache         [-c]        Specify a file or directory where the cache will be
                              saved. (Default: ./.cloudflare_worker_cache)
  --reload        [-r]        Automatically reload when files change.
  --header        [-h]        Apply a header to all requests. Ex: -h
                              CF-IPCountry:US Can be used multiple times.
  --env           [-e]        Apply an environment variable to the runtime. Can
                              be used multiple times.
  --environment               The Wrangler environment to load.
  --toml          [-f]        Path to the wrangler.toml configuration file. (
                              Default: ./)
  --secrets                   The path to a file where secrets are stored (
                              optional)
  --encrypt       [-enc]      A custom encryption key for accessing secrets.
  ```

**secret**

```bash
cfw secret [FLAGS] | [COMMAND]

  View and manage secrets. This wraps the "wrangler secret" command to make
  secrets available in the local runtime.

Flags:

  --file          [-f]        The file where the secrets are stored locally.
                              Stored in plain text. (Default: .cloudflare_secrets)
  --environment   [-e]        Environment to use
  --encrypt       [-key]      A custom encryption key for saving secrets.

Commands:

  delete|rm           Delete a secret variable from a script
  list|ls             List all secrets for a script
  put                 Create or update a secret variable for a script
```

**publish**

```bash
cfw publish|pub [FLAGS]

  Publish your worker.

Flags:

  --file          [-f]        The file where the secrets are stored locally.
                              Stored in plain text. (Default: .cloudflare_secrets)
  --environment   [-e]        Environment to use
  --secrets       [-s]        Auto-update secrets on Cloudflare. (Default: true)
  --encrypt       [-key]      A custom encryption key for decrypting secrets.
```

## Example

```bash
cfw run --kvs mykv=test.json --reload demo.js
```

```javascript
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest (request) {
  const headers = new Map(request.headers)
  console.log(headers)

  let result = await mykv.get('test')
  if (result === null) {
    await mykv.put('test', 'data', { expirationTtl: 60 })
  }

  console.log(await mykv.get('test'))
  setTimeout(async () => {
    console.log('A record should have expired and null should print below this.')
    console.log(await mykv.get('test'))
  }, 61000)
  // await mykv.delete('test')
  // console.log(await mykv.get('test'))
  // for (let i = 0; i < 100; i++) {
  //   await mykv.put(`example_${i+1}`, (i+1).toString())
  // }
  console.log(await mykv.get('a'))
  console.log(await mykv.list({ limit: 10 }))
  console.log(await mykv.list({ limit: 10, cursor: 10 }))
  return new Response('Unsupported Source', { status: 501 })
}
```

![Screenshot](https://github.com/author/cfw/raw/master/screenshot.png)