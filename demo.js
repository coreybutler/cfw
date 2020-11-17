console.log('ok dokey!')


addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest (request) {
  const headers = new Map(request.headers)
  console.log(headers)

  let result = await mykv.get('test')
  if (result === null) {
    await mykv.put('test', 'blah', { expirationTtl: 60 })
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
