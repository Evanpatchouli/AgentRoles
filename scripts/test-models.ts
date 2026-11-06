import assert from 'node:assert/strict'
import http from 'node:http'
import { listModelsForProvider } from '../src/main/engine/models'

const requests: Array<{ path: string; auth: string; apiKey: string }> = []

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  requests.push({
    path: url.pathname,
    auth: String(request.headers.authorization || ''),
    apiKey: String(request.headers['x-api-key'] || '')
  })
  const send = (status: number, payload: any) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(payload))
  }
  if (url.pathname !== '/v1/models' && url.pathname !== '/models') {
    send(404, { error: { message: 'not found' } })
    return
  }
  const apiKey = String(request.headers['x-api-key'] || '')
  if (apiKey) {
    if (apiKey !== 'anthropic-key') {
      send(401, { error: { message: 'invalid anthropic key' } })
      return
    }
    send(200, { data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-opus-4-1' }] })
    return
  }
  const auth = String(request.headers.authorization || '')
  if (auth !== 'Bearer test-key') {
    send(401, { error: { message: 'invalid api key' } })
    return
  }
  send(200, {
    object: 'list',
    data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }]
  })
})

async function main(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  const base = 'http://127.0.0.1:' + port

  try {
    const openai = await listModelsForProvider({
      provider: 'openai',
      baseUrl: base + '/v1',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      temperature: 0.5,
      maxTokens: 1024
    })
    assert.deepEqual(openai, ['deepseek-chat', 'deepseek-reasoner'])
    assert.equal(requests.at(-1)?.path, '/v1/models')
    assert.equal(requests.at(-1)?.auth, 'Bearer test-key')
    console.log('[models] OpenAI-compatible /v1/models OK')

    const rootBase = await listModelsForProvider({
      provider: 'openai',
      baseUrl: base,
      apiKey: 'test-key',
      model: '',
      temperature: 0.5,
      maxTokens: 1024
    })
    assert.equal(rootBase.length, 2)
    assert.equal(requests.at(-1)?.path, '/models')
    console.log('[models] base without /v1 OK')

    const anthropic = await listModelsForProvider({
      provider: 'anthropic',
      baseUrl: base,
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      temperature: 0.5,
      maxTokens: 1024
    })
    assert.deepEqual(anthropic, ['claude-sonnet-4-5', 'claude-opus-4-1'])
    assert.equal(requests.at(-1)?.path, '/v1/models')
    assert.equal(requests.at(-1)?.apiKey, 'anthropic-key')
    console.log('[models] Anthropic /v1/models OK')

    await assert.rejects(
      () =>
        listModelsForProvider({
          provider: 'openai',
          baseUrl: base + '/v1',
          apiKey: 'bad',
          model: '',
          temperature: 0.5,
          maxTokens: 1024
        }),
      /401.*invalid api key/
    )
    console.log('[models] error forwarding OK')
    console.log('[models] PASS')
  } finally {
    server.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
