import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { embedTexts, embeddingEndpoint } from '../src/main/memory/embedding'

interface Captured {
  path: string
  auth: string
  body: any
}

async function main(): Promise<void> {
  assert.equal(
    embeddingEndpoint('https://api.openai.com/v1/'),
    'https://api.openai.com/v1/embeddings'
  )
  assert.equal(
    embeddingEndpoint('https://example.com/v1/embeddings'),
    'https://example.com/v1/embeddings'
  )

  const captured: Captured[] = []
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      if (request.url !== '/v1/embeddings') {
        response.writeHead(404)
        response.end('not found')
        return
      }
      const payload = JSON.parse(body || '{}')
      captured.push({
        path: request.url,
        auth: String(request.headers.authorization || ''),
        body: payload
      })
      if (request.headers.authorization !== 'Bearer test-key') {
        response.writeHead(401, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'invalid key' } }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          object: 'list',
          model: 'test-embed',
          data: payload.input.map((text: string, index: number) => ({
            object: 'embedding',
            index,
            embedding: [text.length, index + 1, 0.5]
          }))
        })
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  try {
    const settings = {
      enabled: true,
      baseUrl: 'http://127.0.0.1:' + port + '/v1',
      apiKey: 'test-key',
      model: 'test-embed'
    }
    const result = await embedTexts(settings, ['你好', '记忆系统'])
    assert.equal(result.vectors.length, 2)
    assert.equal(result.dimensions, 3)
    assert.equal(result.model, 'test-embed')
    assert.deepEqual([...result.vectors[0]], [2, 1, 0.5])
    assert.equal(captured.length, 1)
    assert.equal(captured[0]!.auth, 'Bearer test-key')
    assert.deepEqual(captured[0]!.body.input, ['你好', '记忆系统'])
    console.log('[embedding] request/response parsing OK')

    await assert.rejects(
      embedTexts({ ...settings, apiKey: 'bad-key' }, ['x']),
      /HTTP 401/
    )
    console.log('[embedding] error forwarding OK')

    await assert.rejects(
      embedTexts({ ...settings, enabled: false }, ['x']),
      /未启用/
    )
    console.log('[embedding] disabled guard OK')

    console.log('[embedding] PASS')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
