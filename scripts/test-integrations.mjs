import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import readline from 'node:readline'

const messages = []
const server = http.createServer((request, response) => {
  const token = (request.headers.authorization || '').replace(/^Bearer /i, '')
  const send = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (request.url === '/health') {
    send(200, { ok: true, app: 'AgentRoles', version: '0.1.0', agents: 1 })
    return
  }
  if (token !== 'test-token') {
    send(401, { ok: false, error: 'unauthorized' })
    return
  }
  if (request.method === 'GET' && request.url === '/v1/agents') {
    send(200, { ok: true, agents: [{ id: 'a1', name: '需求记录员', tagline: '记录需求', avatar: '◈', autoRun: true }] })
    return
  }
  if (request.method === 'GET' && /^\/v1\/agents\/[^/]+\/sessions$/.test(request.url)) {
    send(200, {
      ok: true,
      sessions: [
        { id: 'default', title: '默认会话', updatedAt: Date.now() },
        { id: 's2', title: '项目 A', updatedAt: Date.now() - 60000 }
      ]
    })
    return
  }
  if (request.method === 'POST' && /^\/v1\/agents\/[^/]+\/messages$/.test(request.url)) {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const payload = JSON.parse(body)
      messages.push({ agent: decodeURIComponent(request.url.split('/')[3]), ...payload })
      send(202, {
        ok: true,
        messageId: 'msg-' + messages.length,
        agentId: 'a1',
        agentName: '需求记录员',
        sessionId: payload.session === '项目 A' ? 's2' : 'default',
        sessionTitle: payload.session || '默认会话',
        started: true
      })
    })
    return
  }
  send(404, { ok: false, error: 'not found' })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = 'http://127.0.0.1:' + server.address().port

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['resources/agentroles-cli.mjs', ...args], {
      cwd: process.cwd()
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

try {
  const agents = await runCli(['agents', '--url', baseUrl, '--token', 'test-token'])
  assert.equal(agents.code, 0, agents.stderr)
  assert.ok(agents.stdout.includes('需求记录员'))

  const sessions = await runCli([
    'sessions',
    '--url',
    baseUrl,
    '--token',
    'test-token',
    '--agent',
    '需求记录员'
  ])
  assert.equal(sessions.code, 0, sessions.stderr)
  assert.ok(sessions.stdout.includes('项目 A'))

  const sent = await runCli([
    'send',
    '--url',
    baseUrl,
    '--token',
    'test-token',
    '--agent',
    '需求记录员',
    '--content',
    '登录页改版，周五前完成',
    '--source',
    'codex',
    '--title',
    '登录页改版',
    '--session',
    '项目 A'
  ])
  assert.equal(sent.code, 0, sent.stderr)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].agent, '需求记录员')
  assert.equal(messages[0].source, 'codex')
  assert.equal(messages[0].title, '登录页改版')
  assert.equal(messages[0].session, '项目 A')
  console.log('[cli] agents + sessions + send OK')

  const mcp = spawn(process.execPath, ['resources/mcp-server.mjs', '--url', baseUrl, '--token', 'test-token'], {
    cwd: process.cwd()
  })
  const lines = readline.createInterface({ input: mcp.stdout })
  const pending = new Map()
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    const resolver = pending.get(message.id)
    if (resolver) {
      pending.delete(message.id)
      resolver(message)
    }
  })
  const request = (id, method, params) =>
    new Promise((resolve) => {
      pending.set(id, resolve)
      mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })

  const init = await request(1, 'initialize', { protocolVersion: '2024-11-05' })
  assert.equal(init.result.serverInfo.name, 'agentroles')
  const list = await request(2, 'tools/list', {})
  assert.equal(list.result.tools.length, 3)
  const sessionsCall = await request(3, 'tools/call', {
    name: 'agentroles_list_sessions',
    arguments: { agent: '需求记录员' }
  })
  assert.ok(sessionsCall.result.content[0].text.includes('项目 A'))
  const call = await request(4, 'tools/call', {
    name: 'agentroles_send_message',
    arguments: {
      agent: '需求记录员',
      content: 'MCP 投递的需求',
      source: 'codex',
      session: '项目 A'
    }
  })
  assert.ok(call.result.content[0].text.includes('已接收'))
  assert.ok(call.result.content[0].text.includes('项目 A'))
  assert.equal(messages.length, 2)
  assert.equal(messages[1].content, 'MCP 投递的需求')
  assert.equal(messages[1].source, 'codex')
  assert.equal(messages[1].session, '项目 A')
  mcp.kill()
  console.log('[mcp] initialize + tools/list + tools/call OK')
  console.log('[integration] PASS')
} finally {
  server.close()
}
