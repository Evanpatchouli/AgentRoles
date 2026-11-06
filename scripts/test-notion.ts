import assert from 'node:assert/strict'
import http from 'node:http'

interface Captured {
  path: string
  method: string
  body: any
}
const captured: Captured[] = []

const database = {
  object: 'database',
  id: 'dbdemo',
  url: 'https://www.notion.so/dbdemo',
  title: [{ plain_text: '任务库' }],
  properties: {
    Name: { id: 'title', name: 'Name', type: 'title', title: {} },
    Status: {
      id: 'status',
      name: 'Status',
      type: 'status',
      status: { options: [{ name: '待开始' }, { name: '进行中' }, { name: '已完成' }] }
    },
    Priority: {
      id: 'prio',
      name: 'Priority',
      type: 'select',
      select: { options: [{ name: '高' }, { name: '中' }, { name: '低' }] }
    },
    Due: { id: 'due', name: 'Due', type: 'date', date: {} }
  }
}

const server = http.createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const path = url.pathname
    const send = (status: number, payload: any) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(payload))
    }
    if ((request.headers.authorization || '') !== 'Bearer test-token') {
      send(401, { object: 'error', message: 'unauthorized' })
      return
    }
    const parsed = body ? JSON.parse(body) : undefined
    captured.push({ path, method: request.method || 'GET', body: parsed })

    if (request.method === 'GET' && path === '/v1/databases/dbdemo') {
      send(200, database)
      return
    }
    if (request.method === 'POST' && path === '/v1/pages') {
      send(200, { id: 'page1', url: 'https://www.notion.so/page1' })
      return
    }
    if (request.method === 'GET' && path === '/v1/pages/page1') {
      send(200, {
        id: 'page1',
        url: 'https://www.notion.so/page1',
        parent: { type: 'database_id', database_id: 'dbdemo' },
        properties: {}
      })
      return
    }
    if (request.method === 'PATCH' && path === '/v1/pages/page1') {
      send(200, { id: 'page1', url: 'https://www.notion.so/page1' })
      return
    }
    if (request.method === 'PATCH' && path === '/v1/blocks/page1/children') {
      send(200, { results: [] })
      return
    }
    if (request.method === 'POST' && path === '/v1/databases/dbdemo/query') {
      send(200, {
        has_more: false,
        results: [
          {
            id: 'page1',
            url: 'https://www.notion.so/page1',
            properties: {
              Name: { type: 'title', title: [{ plain_text: '登录页改版' }] },
              Status: { type: 'status', status: { name: '进行中' } },
              Priority: { type: 'select', select: { name: '高' } },
              Due: { type: 'date', date: { start: '2026-11-20' } }
            }
          }
        ]
      })
      return
    }
    send(404, { object: 'error', message: 'not found: ' + path })
  })
})

async function main(): Promise<void> {
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as any).port
process.env.AGENTROLES_NOTION_BASE = 'http://127.0.0.1:' + port + '/v1'

const { createAgent, defaultSettings } = await import('../src/main/defaults')
const { notionSkill } = await import('../src/main/skills/notion')

const agent = createAgent({ name: '测试', role: '测试' }, ['notion', 'memory'])
agent.skills.notion = { enabled: true, settings: {} }
const settings = defaultSettings('C:\\temp\\agentroles-test')
settings.notion = { token: 'test-token', databaseId: 'dbdemo' }
const context = {
  agent,
  settings,
  dataDir: 'C:\\temp\\agentroles-test',
  workspaceDir: 'C:\\temp\\agentroles-test',
  signal: AbortSignal.timeout(8000)
}

function tool(name: string) {
  const found = notionSkill.tools.find((item) => item.name === name)
  assert.ok(found, 'tool missing: ' + name)
  return found!
}

try {
  const created = await tool('notion_create_task').execute(
    {
      title: '登录页改版',
      status: '进行中',
      priority: '高',
      due_date: '2026-11-20',
      notes: '背景：登录体验老旧。\n\n验收：支持一次性验证码。'
    },
    context
  )
  const createdData = JSON.parse(created)
  assert.equal(createdData.ok, true)
  assert.equal(createdData.id, 'page1')
  const createCall = captured.find((item) => item.path === '/v1/pages')!
  const properties = createCall.body.properties
  assert.equal(properties.Name.title[0].text.content, '登录页改版')
  assert.equal(properties.Status.status.name, '进行中')
  assert.equal(properties.Priority.select.name, '高')
  assert.equal(properties.Due.date.start, '2026-11-20')
  assert.ok(Array.isArray(createCall.body.children))
  assert.ok(createCall.body.children.length >= 1)
  console.log('[notion] create task payload OK')

  captured.length = 0
  const invalid = await tool('notion_create_task').execute(
    { title: '无效状态任务', status: '不存在的状态' },
    context
  )
  const invalidData = JSON.parse(invalid)
  assert.equal(invalidData.ok, true)
  assert.ok(Array.isArray(invalidData.warnings) && invalidData.warnings.length >= 1)
  const invalidCall = captured.find((item) => item.path === '/v1/pages')!
  assert.equal(invalidCall.body.properties.Status, undefined)
  console.log('[notion] invalid status warning OK')

  captured.length = 0
  const found = await tool('notion_find_task').execute(
    { query: '登录', status: '进行中' },
    context
  )
  const foundData = JSON.parse(found)
  assert.equal(foundData.tasks.length, 1)
  assert.equal(foundData.tasks[0].title, '登录页改版')
  const queryCall = captured.find((item) => item.path === '/v1/databases/dbdemo/query')!
  assert.ok(queryCall.body.filter.and.length === 2)
  console.log('[notion] find task filter OK')

  captured.length = 0
  const updated = await tool('notion_update_task').execute(
    { page_id: 'page1', status: '已完成', notes: '已完成验证码登录联调。' },
    context
  )
  const updatedData = JSON.parse(updated)
  assert.equal(updatedData.ok, true)
  const patchCall = captured.find(
    (item) => item.path === '/v1/pages/page1' && item.method === 'PATCH'
  )!
  assert.equal(patchCall.body.properties.Status.status.name, '已完成')
  const appendCall = captured.find((item) => item.path === '/v1/blocks/page1/children')!
  assert.ok(appendCall.body.children.length >= 1)
  console.log('[notion] update task + append notes OK')

  console.log('[notion] PASS')
} finally {
  server.close()
}
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
