import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroles-e2e-'))
const workspace = path.join(userData, 'workspace')
fs.mkdirSync(workspace, { recursive: true })
const attachmentFilePath = path.join(userData, 'attachment.txt')
fs.writeFileSync(attachmentFilePath, '这是通过聊天附件上传的文本文件。\n第二行内容。', 'utf8')
const ingressPort = 43177
let attachmentPayloadSeen = false
let memoryInjected = false
let extractionCalls = 0

function writeConfig(modelPort) {
  const now = Date.now()
  const config = {
    version: 1,
    agents: [
      {
        id: 'agent-test',
        name: '测试记录员',
        avatar: '◈',
        color: '#c9f36b',
        tagline: '把外部消息记成任务',
        role: '你负责记录需求。收到消息后调用 memory_set 保存关键信息，再简短汇报。',
        model: {
          provider: 'openai',
          baseUrl: 'http://127.0.0.1:' + modelPort + '/v1',
          apiKey: 'test-key',
          model: 'mock-model',
          temperature: 0.2,
          maxTokens: 1024
        },
        skills: {
          memory: { enabled: true, settings: {} },
          notion: { enabled: false, settings: {} }
        },
        autoRun: true,
        createdAt: now,
        updatedAt: now
      }
    ],
    settings: {
      notion: { token: '', databaseId: '' },
      ingress: { enabled: true, port: ingressPort, token: 'test-token' },
      memory: {
        extractionEnabled: true,
        autoAcceptConfidence: 0.9,
        embedding: {
          enabled: false,
          baseUrl: 'http://127.0.0.1:' + modelPort + '/v1',
          apiKey: '',
          model: 'mock-embed'
        }
      },
      workspaceDir: workspace
    }
  }
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify(config, null, 2))
}

const modelServer = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
    return
  }
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'mock-model' }, { id: 'mock-model-lite' }]
      })
    )
    return
  }
  if (request.method === 'GET' && request.url === '/releases-list') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify([
        {
          tag_name: 'v0.1.1',
          name: 'AgentRoles v0.1.1',
          published_at: '2026-11-06T10:00:00Z',
          html_url: 'https://github.com/Evanpatchouli/AgentRoles/releases/tag/v0.1.1',
          body: '### 新功能\n\n- 测试版本更新记录\n- 优化更新检查流程',
          draft: false,
          prerelease: false
        },
        {
          tag_name: 'v0.1.0',
          name: 'AgentRoles 初始版本',
          published_at: '2026-11-05T10:00:00Z',
          html_url: 'https://github.com/Evanpatchouli/AgentRoles/releases/tag/v0.1.0',
          body: '### 初始版本\n\n- 多角色与多会话',
          draft: false,
          prerelease: false
        }
      ])
    )
    return
  }
  if (request.method === 'GET' && request.url === '/releases/latest') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        tag_name: 'v0.1.1',
        name: 'AgentRoles v0.1.1',
        published_at: '2026-11-06T10:00:00Z',
        html_url: 'https://github.com/Evanpatchouli/AgentRoles/releases/tag/v0.1.1',
        body: '测试更新说明：修复若干问题。',
        assets: [
          {
            name: 'AgentRoles Setup 0.1.1.exe',
            browser_download_url:
              'https://github.com/Evanpatchouli/AgentRoles/releases/download/v0.1.1/AgentRoles-Setup-0.1.1.exe'
          }
        ]
      })
    )
    return
  }
  let body = ''
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    const payload = JSON.parse(body || '{}')
    const messages = Array.isArray(payload.messages) ? payload.messages : []
    const serializedMessages = JSON.stringify(messages)
    if (
      serializedMessages.includes('image_url') &&
      serializedMessages.includes('attachment.txt') &&
      serializedMessages.includes('这是通过聊天附件上传的文本文件')
    ) {
      attachmentPayloadSeen = true
    }
    const systemMessage = messages.find((message) => message.role === 'system')
    const systemText = String(systemMessage?.content || '')
    if (
      systemMessage &&
      systemText.includes('长期记忆摘要') &&
      systemText.includes('project')
    ) {
      memoryInjected = true
    }
    if (systemText.includes('长期记忆提取器')) {
      extractionCalls += 1
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const sendExtraction = (data) => {
        response.write('data: ' + JSON.stringify(data) + '\n\n')
      }
      sendExtraction({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
      sendExtraction({
        choices: [
          {
            index: 0,
            delta: {
              content: JSON.stringify([
                {
                  key: 'e2e_pref',
                  content: 'E2E 偏好：回复先结论，再风险',
                  kind: 'preference',
                  scope: 'agent',
                  tags: ['e2e'],
                  confidence: 0.6,
                  reason: '测试待确认流程'
                }
              ])
            },
            finish_reason: null
          }
        ]
      })
      sendExtraction({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    const hasToolResult = messages.some((message) => message.role === 'tool')
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    const send = (data) => {
      response.write('data: ' + JSON.stringify(data) + '\n\n')
    }
    send({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
    if (!hasToolResult) {
      send({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_mem_1',
                  type: 'function',
                  function: {
                    name: 'memory_set',
                    arguments: JSON.stringify({ key: 'project', value: 'AgentRoles' })
                  }
                }
              ]
            },
            finish_reason: null
          }
        ]
      })
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    } else {
      for (const part of ['好的，', '已记录', '「AgentRoles」', '到长期记忆。']) {
        send({ choices: [{ index: 0, delta: { content: part }, finish_reason: null }] })
      }
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    }
    response.write('data: [DONE]\n\n')
    response.end()
  })
})

await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve))
const modelPort = modelServer.address().port
writeConfig(modelPort)
console.log('[e2e] userData:', userData)
console.log('[e2e] mock model on', modelPort)

const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: {
    ...process.env,
    AGENTROLES_USER_DATA: userData,
    AGENTROLES_RELEASES_API: 'http://127.0.0.1:' + modelPort + '/releases/latest',
    AGENTROLES_RELEASES_LIST_API: 'http://127.0.0.1:' + modelPort + '/releases-list'
  }
})
const appPid = app.process().pid

const page = await app.firstWindow()
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[renderer error]', message.text())
})
page.on('pageerror', (error) => console.log('[renderer pageerror]', error.message))

try {
  await page.waitForSelector('.composer textarea', { timeout: 20000 })
  await page.waitForTimeout(800)
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-initial.png') })
  console.log('[e2e] initial UI rendered')

  await page.fill('.composer textarea', '记录一下：AgentRoles 项目启动')
  await page.press('.composer textarea', 'Enter')

  await page.waitForFunction(
    () => {
      const nodes = Array.from(document.querySelectorAll('.msg-assistant'))
      return nodes.some((node) => (node.textContent || '').includes('已记录'))
    },
    null,
    { timeout: 30000 }
  )
  console.log('[e2e] assistant replied with tool loop')

  // 附件：拖入、粘贴图片、+ 菜单与文件选择器
  await page.evaluate((text) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([text], '拖入说明.txt', { type: 'text/plain' }))
    const target = document.querySelector('.chat')
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        })
      )
    }
  }, '这是拖拽进入聊天框的文件。')
  await page.waitForSelector('.composer-attachment-list .attachment-file')
  await page.locator('.composer-attachment-list .attachment-remove').click()

  const imageBase64 = fs.readFileSync(path.join(root, 'build', 'icon.png')).toString('base64')
  await page.evaluate((base64) => {
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const file = new File([bytes], 'pasted.png', { type: 'image/png' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: transfer })
    document.querySelector('.composer textarea')?.dispatchEvent(event)
  }, imageBase64)
  await page.waitForSelector('.composer-attachment-list .attachment-image')
  await page.locator('.composer-attachment-list .attachment-remove').click()

  await page.locator('.composer-add').click()
  await page.waitForSelector('.attach-menu')
  const attachOptions = await page.locator('.attach-menu-item').allTextContents()
  assert.deepEqual(attachOptions.map((label) => label.trim()), ['图片', '文件'])
  await page.waitForTimeout(220)
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-attach-menu.png') })
  await page.keyboard.press('Escape')

  await page
    .locator('[data-attachment-input="image"]')
    .setInputFiles(path.join(root, 'build', 'icon.png'))
  await page.waitForFunction(
    () => document.querySelectorAll('.composer-attachment-list .attachment-image').length === 1
  )
  await page.locator('[data-attachment-input="file"]').setInputFiles(attachmentFilePath)
  await page.waitForFunction(
    () => document.querySelectorAll('.composer-attachment-list .attachment-tile').length === 2
  )
  const assistantBeforeAttachments = await page.locator('.msg-assistant').count()
  await page.locator('.composer textarea').fill('请查看这两个附件')
  await page.locator('.composer textarea').press('Enter')
  await page.waitForFunction(
    (count) => document.querySelectorAll('.msg-assistant').length > count,
    assistantBeforeAttachments,
    { timeout: 30000 }
  )
  await page.waitForFunction(() => !document.querySelector('.composer-attachment-list'))
  assert.equal(attachmentPayloadSeen, true, 'image and text attachment should reach the model')
  const attachmentMessage = page.locator('.msg-user').last()
  assert.equal(await attachmentMessage.locator('.attachment-image').count(), 1)
  assert.equal(await attachmentMessage.locator('.attachment-file').count(), 1)
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-attachments.png') })
  console.log('[e2e] attachments drag/paste/picker + send OK')

  const userMessage = page.locator('.msg-user').first()
  await page.mouse.move(1200, 840)
  await page.waitForTimeout(150)
  const copyOpacity = await page
    .locator('.msg-user .msg-copy')
    .first()
    .evaluate((element) => getComputedStyle(element).opacity)
  assert.equal(copyOpacity, '0')
  await userMessage.hover()
  const userCopy = page.locator('.msg-user .user-meta .link-btn').first()
  await page.waitForFunction(() => {
    const element = document.querySelector('.msg-user .msg-copy')
    return element ? getComputedStyle(element).opacity === '1' : false
  })
  await userCopy.click()
  await page.waitForFunction(() => {
    const button = document.querySelector('.msg-user .user-meta .link-btn')
    return Boolean(button && button.textContent && button.textContent.includes('已复制'))
  })
  console.log('[e2e] user message copy button OK')

  const toolCards = await page.locator('.tool-card').count()
  assert.ok(toolCards >= 1, 'expected at least one tool card')
  const memoryFile = path.join(userData, 'memory', 'agent-test.json')
  assert.ok(fs.existsSync(memoryFile), 'memory file should exist')
  const memory = JSON.parse(fs.readFileSync(memoryFile, 'utf8'))
  assert.equal(memory.version, 2)
  const projectMemory = memory.records.find((item) => item.key === 'project')
  assert.ok(projectMemory, 'project memory record should exist')
  assert.equal(projectMemory.content, 'AgentRoles')
  assert.ok(projectMemory.id.startsWith('mem_'))
  assert.ok(
    fs.existsSync(path.join(userData, 'memory', 'index.sqlite')),
    'SQLite FTS5 index should be created'
  )
  assert.equal(memoryInjected, true, 'next turn should inject recalled memory into system prompt')
  console.log('[e2e] memory skill executed with structured record')

  // 等待两轮对话的自动提取完成，避免与管理页操作竞态
  const extractionDeadline = Date.now() + 15000
  while (extractionCalls < 2 && Date.now() < extractionDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(extractionCalls >= 2, 'both runs should trigger memory extraction')

  // 记忆管理页：待确认候选、确认、切换核心记忆
  await page.locator('.tab').filter({ hasText: '记忆' }).click()
  await page.waitForSelector('.memory-card', { timeout: 10000 })
  let memoryPanelText = await page.locator('.memory-panel').innerText()
  assert.ok(memoryPanelText.includes('project'))
  assert.ok(memoryPanelText.includes('AgentRoles'))
  assert.ok(memoryPanelText.includes('1 / 200'))
  await page.waitForSelector('.memory-pending', { timeout: 10000 })
  const pendingText = await page.locator('.memory-pending').innerText()
  assert.ok(pendingText.includes('待确认记忆'))
  assert.ok(pendingText.includes('e2e_pref'))
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-memory-pending.png') })
  await page.locator('.memory-candidate-actions .btn-primary').first().click()
  await page.waitForFunction(() => !document.querySelector('.memory-pending'))
  await page.waitForFunction(() => document.querySelectorAll('.memory-card').length === 2)
  memoryPanelText = await page.locator('.memory-panel').innerText()
  assert.ok(memoryPanelText.includes('2 / 200'))
  assert.ok(memoryPanelText.includes('e2e_pref'))
  await page.locator('.memory-card-actions .icon-btn').first().click()
  await page.waitForFunction(() =>
    Boolean(document.querySelector('.memory-card.is-pinned'))
  )
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-memory.png') })
  await page.locator('.memory-card-actions .icon-btn').first().click()
  await page.waitForFunction(() =>
    Boolean(document.querySelector('.memory-card') && !document.querySelector('.memory-card.is-pinned'))
  )
  await page.locator('.tab').filter({ hasText: '会话' }).click()
  await page.waitForSelector('.composer textarea')
  console.log('[e2e] memory management + pending confirmation OK')

  // 外部 Agent 投递：走真实 HTTP 入口
  const response = await fetch('http://127.0.0.1:' + ingressPort + '/v1/agents/agent-test/messages', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: '来自 MCP 的需求：补充导出周报能力',
      source: 'mcp',
      title: '导出周报'
    })
  })
  assert.equal(response.status, 202, 'ingress should accept message')
  const accepted = await response.json()
  assert.ok(accepted.messageId)
  console.log('[e2e] ingress accepted external message')

  await page.waitForFunction(
    () => (document.body.textContent || '').includes('来自 MCP 的需求'),
    null,
    { timeout: 20000 }
  )
  await page.waitForTimeout(2000)

  const external = await page.locator('.msg-user.is-external').count()
  assert.ok(external >= 1, 'external message should be rendered')
  const sourcePill = await page.locator('.msg-user.is-external .source-pill').first().innerText()
  assert.ok(sourcePill.includes('MCP'), 'source pill should show MCP')
  console.log('[e2e] external message rendered in chat')

  const atBottom = await page
    .locator('.chat-scroll')
    .evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight < 220)
  assert.ok(atBottom, 'chat should follow the newest external message')

  // 展开第一个工具卡片，验证参数与结果可见
  await page.locator('.tool-head').first().click()
  await page.waitForTimeout(300)
  const toolBody = await page.locator('.tool-body').first().innerText()
  assert.ok(toolBody.includes('memory_set') || toolBody.includes('project'))
  await page.locator('.chat-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-chat.png') })

  const assistantCount = await page.locator('.msg-assistant').count()
  assert.ok(assistantCount >= 2, 'expected a second assistant reply')
  console.log('[e2e] chat screenshot saved; assistant messages:', assistantCount)

  // 多会话：新建、自动标题、切换回历史会话并验证消息隔离
  await page.locator('.agent-actions .btn').filter({ hasText: '新会话' }).click()
  await page.waitForSelector('.chat-empty', { timeout: 10000 })
  assert.ok((await page.locator('.session-item').count()) >= 2)
  await page.locator('.composer textarea').fill('第二个会话：检查会话隔离')
  await page.locator('.composer textarea').press('Enter')
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.session-title')).some((element) =>
        (element.textContent || '').includes('第二个会话')
      ),
    null,
    { timeout: 20000 }
  )
  await page.waitForFunction(
    () => (document.querySelector('.chat-scroll')?.textContent || '').includes('已记录'),
    null,
    { timeout: 20000 }
  )
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-sessions.png') })

  const sessionsResponse = await fetch(
    'http://127.0.0.1:' + ingressPort + '/v1/agents/agent-test/sessions',
    { headers: { Authorization: 'Bearer test-token' } }
  )
  assert.equal(sessionsResponse.status, 200)
  const sessionsData = await sessionsResponse.json()
  assert.ok(
    sessionsData.sessions.some((session) => session.title.includes('第二个会话')),
    'sessions endpoint should list the new session'
  )

  await page
    .locator('.session-main')
    .filter({ hasText: 'AgentRoles 项目启动' })
    .click()
  await page.waitForFunction(
    () => (document.querySelector('.chat-scroll')?.textContent || '').includes('来自 MCP 的需求'),
    null,
    { timeout: 15000 }
  )
  const oldSessionText = await page.locator('.chat-scroll').innerText()
  assert.ok(!oldSessionText.includes('第二个会话：检查会话隔离'))
  assert.ok((await page.locator('.session-chip').innerText()).includes('AgentRoles'))

  await page.locator('.agent-expand').click()
  await page.waitForFunction(() => document.querySelectorAll('.session-item').length === 0)
  await page.locator('.agent-item').click()
  await page.waitForSelector('.session-item')
  console.log('[e2e] multi-session create/title/switch/collapse/isolation OK')

  // 外部消息按 session 路由
  const sessionResponse = await fetch(
    'http://127.0.0.1:' + ingressPort + '/v1/agents/agent-test/messages',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: '来自 MCP 的第二个会话消息',
        source: 'mcp',
        session: '第二个会话：检查会话隔离'
      })
    }
  )
  assert.equal(sessionResponse.status, 202)
  const sessionAccepted = await sessionResponse.json()
  assert.equal(sessionAccepted.sessionTitle, '第二个会话：检查会话隔离')
  await page
    .locator('.session-main')
    .filter({ hasText: '第二个会话' })
    .click()
  await page.waitForFunction(
    () =>
      (document.querySelector('.chat-scroll')?.textContent || '').includes(
        '来自 MCP 的第二个会话消息'
      ),
    null,
    { timeout: 20000 }
  )
  await page
    .locator('.session-main')
    .filter({ hasText: 'AgentRoles 项目启动' })
    .click()
  console.log('[e2e] ingress session routing OK')

  // 会话右键菜单：定位、图标左置、文字右对齐、重命名/置顶/归档
  await page.locator('.agent-actions .btn').filter({ hasText: '新会话' }).click()
  await page.waitForSelector('.chat-empty')
  const menuTarget = page.locator('.session-main').filter({ hasText: '新会话' }).first()
  await menuTarget.waitFor()

  const targetBox = await menuTarget.boundingBox()
  assert.ok(targetBox)
  const topClick = { x: targetBox.x + 30, y: targetBox.y + 10 }
  await menuTarget.evaluate(
    (element, point) =>
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: point.x,
          clientY: point.y
        })
      ),
    topClick
  )
  await page.waitForSelector('.session-menu')
  await page.waitForTimeout(120)
  const topMenuBox = await page.locator('.session-menu').boundingBox()
  assert.ok(topMenuBox)
  assert.ok(Math.abs(topMenuBox.x - topClick.x) <= 1)
  assert.ok(Math.abs(topMenuBox.y - topClick.y) <= 1)
  assert.equal(await page.locator('.session-menu-item').count(), 3)
  assert.equal(await page.locator('.session-menu-icon svg').count(), 3)
  const iconBox = await page.locator('.session-menu-icon').first().boundingBox()
  const labelBox = await page.locator('.session-menu-label').first().boundingBox()
  assert.ok(iconBox && labelBox && iconBox.x < labelBox.x)
  const labelAlign = await page
    .locator('.session-menu-label')
    .first()
    .evaluate((element) => getComputedStyle(element).textAlign)
  assert.equal(labelAlign, 'right')
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-session-menu.png') })
  await page.keyboard.press('Escape')

  const viewportHeight = await page.evaluate(() => window.innerHeight)
  const bottomClick = { x: targetBox.x + 30, y: viewportHeight - 12 }
  await menuTarget.evaluate(
    (element, point) =>
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: point.x,
          clientY: point.y
        })
      ),
    bottomClick
  )
  await page.waitForSelector('.session-menu')
  await page.waitForTimeout(120)
  const bottomMenuBox = await page.locator('.session-menu').boundingBox()
  assert.ok(bottomMenuBox)
  assert.ok(Math.abs(bottomMenuBox.y + bottomMenuBox.height - bottomClick.y) <= 1)
  await page.keyboard.press('Escape')

  await menuTarget.click({ button: 'right' })
  await page.locator('.session-menu-item').filter({ hasText: '重命名' }).click()
  await page.waitForSelector('.session-rename-input')
  await page.locator('.session-rename-input').fill('右键菜单测试')
  await page.locator('.session-rename-input').press('Enter')
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.session-title')).some(
        (element) => element.textContent === '右键菜单测试'
      )
  )
  const renamedSession = await page.evaluate(async () => {
    const state = await window.api.getState()
    return state.sessions.find((session) => session.title === '右键菜单测试')
  })
  assert.ok(renamedSession)
  assert.equal(renamedSession.customTitle, true)

  const renamedTarget = page.locator('.session-main').filter({ hasText: '右键菜单测试' })
  await renamedTarget.click({ button: 'right' })
  await page.locator('.session-menu-item').filter({ hasText: '置顶' }).click()
  await page.waitForSelector('.session-pin')
  assert.equal(
    await page.locator('.session-title').first().innerText(),
    '右键菜单测试'
  )

  await renamedTarget.click({ button: 'right' })
  await page.locator('.session-menu-item').filter({ hasText: '归档' }).click()
  await page.waitForSelector('.session-archive-toggle')
  assert.ok(!(await page.locator('.session-chip').innerText()).includes('右键菜单测试'))

  await page.locator('.session-archive-toggle').click()
  await page.waitForSelector('.session-item.is-archived')
  const archivedTarget = page
    .locator('.session-item.is-archived .session-main')
    .filter({ hasText: '右键菜单测试' })
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-session-archive.png') })
  await archivedTarget.click()
  await page.waitForSelector('.session-archived-badge')
  assert.equal(await page.locator('.composer textarea').isDisabled(), true)
  await archivedTarget.click({ button: 'right' })
  await page.locator('.session-menu-item').filter({ hasText: '取消归档' }).click()
  await page.waitForFunction(() => !document.querySelector('.session-archive-toggle'))
  await page.waitForFunction(
    () => !(document.querySelector('.composer textarea')?.disabled ?? false)
  )
  assert.equal(await page.locator('.session-item.is-archived').count(), 0)
  console.log('[e2e] session context menu rename/pin/archive + placement OK')

  await page
    .locator('.session-main')
    .filter({ hasText: 'AgentRoles 项目启动' })
    .click()

  // 模型页：拉取模型列表 + 输入框下拉选择
  await page.locator('.tab').filter({ hasText: '模型' }).click()
  await page.locator('.model-fetch').click()
  await page.waitForSelector('.combo-item', { timeout: 15000 })
  const options = await page.locator('.combo-item').count()
  assert.ok(options >= 2, 'expected models from /v1/models')
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-models.png') })

  await page.locator('.combo-item').filter({ hasText: /^mock-model-lite$/ }).click()
  assert.equal(await page.locator('.combo-input').inputValue(), 'mock-model-lite')
  await page.locator('.combo-input').click()
  await page.waitForSelector('.combo-menu')
  await page.locator('.combo-item').filter({ hasText: /^mock-model$/ }).click()
  assert.equal(await page.locator('.combo-input').inputValue(), 'mock-model')
  console.log('[e2e] model list fetch + combobox selection OK')

  // 温度提示浮层：悬浮出现，内容可读
  await page.locator('.info-tip-trigger').hover()
  await page.waitForSelector('.info-tip-popover')
  await page.waitForTimeout(350)
  const tipText = await page.locator('.info-tip-popover').innerText()
  assert.ok(tipText.includes('Temperature'))
  assert.ok(tipText.includes('随机程度'))
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-tooltip.png') })
  console.log('[e2e] temperature info tooltip OK')

  // 设置页：记忆检索与提取配置渲染
  await page.locator('.nav-item').filter({ hasText: '设置' }).click()
  await page.waitForSelector('.settings-view')
  const memorySettings = page
    .locator('.settings-card')
    .filter({ hasText: '记忆检索与提取' })
  await memorySettings.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  const memorySettingsText = await memorySettings.innerText()
  assert.ok(memorySettingsText.includes('SQLite FTS5'))
  assert.ok(memorySettingsText.includes('Embedding'))
  assert.ok(memorySettingsText.includes('对话结束后自动提取记忆'))
  await page.screenshot({
    path: path.join(root, 'screenshots', 'e2e-settings-memory.png')
  })
  await page.locator('.nav-item').filter({ hasText: '工作台' }).click()
  await page.waitForSelector('.agent-view')
  console.log('[e2e] memory settings section OK')

  // 角色头像上传：选择本地图片 -> 压缩 -> 保存 -> 侧栏/标题区生效
  await page.locator('.tab').filter({ hasText: '角色' }).click()

  // 强调色色弱辅助：悬浮每个色块显示颜色名称与色值
  const colorNames = ['青柠绿', '天蓝', '珊瑚橙', '薰衣草紫', '薄荷青', '暖黄', '樱花粉', '浅草绿']
  for (let index = 0; index < colorNames.length; index += 1) {
    const swatch = page.locator('.swatch').nth(index)
    await swatch.hover()
    const tooltip = swatch.locator('.swatch-tooltip')
    await tooltip.waitFor({ state: 'visible' })
    const tooltipText = await tooltip.innerText()
    assert.ok(tooltipText.includes(colorNames[index]), 'missing color name ' + colorNames[index])
    assert.ok(tooltipText.includes('#'))
  }
  await page.locator('.swatch').first().hover()
  await page.waitForTimeout(180)
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-swatch-tooltip.png') })
  const accentHint = await page
    .locator('.field-hint')
    .filter({ hasText: '当前：' })
    .first()
    .innerText()
  assert.ok(accentHint.includes('#'))
  console.log('[e2e] accent color tooltips OK')

  await page.locator('input[type=file]').setInputFiles(path.join(root, 'build', 'icon.png'))
  await page.waitForSelector('.avatar-preview img', { timeout: 15000 })
  const avatarSource = await page.locator('.avatar-preview img').getAttribute('src')
  assert.ok(avatarSource && avatarSource.startsWith('data:image/webp'))
  await page.getByRole('button', { name: '保存角色' }).click()
  await page.waitForFunction(() => document.body.textContent.includes('角色已保存'))
  await page.waitForSelector('.agent-orb img', { timeout: 10000 })
  assert.ok((await page.locator('.agent-avatar img').count()) >= 1)
  const savedConfig = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'))
  const savedAgent = savedConfig.agents.find((item) => item.id === 'agent-test')
  assert.ok(
    savedAgent?.avatarImage && savedAgent.avatarImage.startsWith('data:image/webp'),
    'avatar image should be persisted in config'
  )
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-avatar.png') })
  console.log('[e2e] avatar upload + save OK')

  // 主题：浅色 / 深色 / 跟随系统，切换后应持久化
  await page.locator('.theme-option[data-theme-option="light"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.waitForTimeout(350)
  const lightConfig = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'))
  assert.equal(lightConfig.settings.theme, 'light')
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-light-role.png') })

  await page.locator('.theme-option[data-theme-option="dark"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')

  await page.locator('.theme-option[data-theme-option="system"]').click()
  await page.waitForTimeout(400)
  const systemTheme = await page.evaluate(() => document.documentElement.dataset.theme)
  assert.ok(systemTheme === 'light' || systemTheme === 'dark')
  const systemConfig = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'))
  assert.equal(systemConfig.settings.theme, 'system')

  await page.locator('.theme-option[data-theme-option="light"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.locator('.tab').filter({ hasText: '会话' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-light-chat.png') })
  console.log('[e2e] theme switching + persistence OK')

  // 标题栏更多菜单：一级/二级菜单、缩放、全屏、关于
  await page.locator('.topbar-more').click()
  await page.waitForSelector('.titlebar-menu')
  await page.waitForFunction(() => {
    const menu = document.querySelector('.titlebar-menu')
    return Boolean(menu && getComputedStyle(menu).visibility === 'visible')
  })
  const topMenuLabels = (
    await page.locator('.titlebar-menu .titlebar-menu-label').allTextContents()
  ).map((label) => label.trim())
  assert.deepEqual(topMenuLabels, ['新窗口', '视图', '帮助', '关闭'])
  await page.locator('.titlebar-menu-item').filter({ hasText: '视图' }).hover()
  await page.waitForSelector('.titlebar-submenu')
  const viewMenuLabels = (
    await page.locator('.titlebar-submenu .titlebar-menu-label').allTextContents()
  ).map((label) => label.trim())
  assert.deepEqual(viewMenuLabels, ['放大', '缩小', '切换全屏'])
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-titlebar-menu.png') })

  await page
    .locator('.titlebar-submenu .titlebar-menu-item')
    .filter({ hasText: '放大' })
    .click()
  const zoomedIn = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
  )
  assert.ok(zoomedIn > 1, 'zoom in should increase zoom factor')
  await page.locator('.topbar-more').click()
  await page.locator('.titlebar-menu-item').filter({ hasText: '视图' }).hover()
  await page
    .locator('.titlebar-submenu .titlebar-menu-item')
    .filter({ hasText: '缩小' })
    .click()
  const zoomedOut = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
  )
  assert.ok(zoomedOut < zoomedIn, 'zoom out should decrease zoom factor')

  await page.locator('.topbar-more').click()
  await page.locator('.titlebar-menu-item').filter({ hasText: '视图' }).hover()
  await page
    .locator('.titlebar-submenu .titlebar-menu-item')
    .filter({ hasText: '切换全屏' })
    .click()
  await page.waitForTimeout(350)
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFullScreen()
    ),
    true
  )
  await page.locator('.topbar-more').click()
  await page.locator('.titlebar-menu-item').filter({ hasText: '视图' }).hover()
  await page
    .locator('.titlebar-submenu .titlebar-menu-item')
    .filter({ hasText: '切换全屏' })
    .click()
  await page.waitForTimeout(350)
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFullScreen()
    ),
    false
  )

  await page.locator('.topbar-more').click()
  await page.locator('.titlebar-menu-item').filter({ hasText: '帮助' }).hover()
  await page.waitForSelector('.titlebar-submenu')
  const helpMenu = page.locator('.titlebar-submenu')
  for (const label of ['文档', '新功能', '反馈', '检查更新']) {
    assert.equal(
      await helpMenu.locator('.titlebar-menu-item').filter({ hasText: label }).isDisabled(),
      false,
      label + ' should be enabled'
    )
  }
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-titlebar-help.png') })

  await helpMenu.locator('.titlebar-menu-item').filter({ hasText: '关于' }).click()
  await page.waitForSelector('.about-card')
  const aboutText = await page.locator('.about-card').innerText()
  const packageVersion = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  ).version
  assert.ok(aboutText.includes('AgentRoles'))
  assert.ok(aboutText.includes('最新发布时间'))
  assert.match(aboutText, /\d{4}-\d{2}-\d{2}/)
  assert.ok(aboutText.includes('v' + packageVersion))
  assert.ok(aboutText.includes('多角色 Agent'))
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-about.png') })
  await page.locator('.about-actions .btn').click()
  await page.waitForFunction(() => !document.querySelector('.about-card'))

  // 新功能：版本时间线（E2E 使用本地 mock Release 列表）
  await page.locator('.topbar-more').click()
  await page.locator('.titlebar-menu-item').filter({ hasText: '帮助' }).hover()
  await page.waitForSelector('.titlebar-submenu')
  await page.waitForSelector('.titlebar-submenu .titlebar-menu-dot', { timeout: 10000 })
  await page.locator('.titlebar-menu-item').filter({ hasText: '新功能' }).click()
  await page.waitForSelector('.whats-new-card', { timeout: 20000 })
  await page.waitForTimeout(300)
  const whatsNewText = await page.locator('.whats-new-card').innerText()
  assert.ok(whatsNewText.includes('版本更新'))
  assert.ok(whatsNewText.includes('v0.1.1'))
  assert.ok(whatsNewText.includes('v0.1.0'))
  assert.ok(whatsNewText.includes('测试版本更新记录'))
  assert.ok(whatsNewText.includes('当前版本'))
  assert.ok(
    whatsNewText.includes('GitHub 最新数据') || whatsNewText.includes('本地缓存')
  )
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-whats-new.png') })
  await page.locator('.whats-new-actions .btn-ghost').click()
  await page.waitForFunction(() => !document.querySelector('.whats-new-card'))
  console.log('[e2e] whats-new release timeline OK')

  // 检查更新：GitHub Release API（E2E 使用本地 mock）
  await page.locator('.topbar-more').click()
  await page.locator('.titlebar-menu-item').filter({ hasText: '帮助' }).hover()
  await page.waitForSelector('.titlebar-submenu')
  assert.equal(await page.locator('.titlebar-submenu .titlebar-menu-dot').count(), 0)
  await page
    .locator('.titlebar-menu-item')
    .filter({ hasText: '检查更新' })
    .click()
  await page.waitForSelector('.update-card', { timeout: 20000 })
  await page.waitForTimeout(300)
  const updateText = await page.locator('.update-card').innerText()
  assert.ok(updateText.includes('发现新版本'))
  assert.ok(updateText.includes('v0.1.1'))
  assert.ok(updateText.includes('v0.1.0'))
  assert.ok(updateText.includes('测试更新说明'))
  await page.screenshot({ path: path.join(root, 'screenshots', 'e2e-update.png') })
  await page.locator('.update-actions .btn-ghost').click()
  await page.waitForFunction(() => !document.querySelector('.update-card'))
  console.log('[e2e] update check + update dialog OK')

  // 新窗口：从菜单打开，再用新窗口的“关闭”关闭它，主窗口不退出
  const newWindowPromise = app.waitForEvent('window')
  await page.locator('.topbar-more').click()
  await page.locator('.titlebar-menu-item').filter({ hasText: '新窗口' }).click()
  const newPage = await newWindowPromise
  await newPage.waitForSelector('.topbar-more', { timeout: 20000 })
  assert.ok(app.windows().length >= 2)
  await newPage.locator('.topbar-more').click()
  const newPageClosed = newPage.waitForEvent('close')
  try {
    await newPage
      .locator('.titlebar-menu-item')
      .filter({ hasText: '关闭' })
      .evaluate((button) => button.click())
  } catch (error) {
    // 点击关闭后页面会立即销毁，Playwright 可能来不及返回 evaluate 结果。
    if (!newPage.isClosed()) throw error
  }
  await newPageClosed
  assert.equal(page.isClosed(), false)
  assert.ok(app.windows().length >= 1)

  // 关闭最后一个窗口：窗口消失，但应用仍驻留（托盘）
  await page.locator('.topbar-more').click()
  const originalClosed = page.waitForEvent('close')
  try {
    await page
      .locator('.titlebar-menu-item')
      .filter({ hasText: '关闭' })
      .evaluate((button) => button.click())
  } catch (error) {
    if (!page.isClosed()) throw error
  }
  await originalClosed
  assert.equal(app.windows().length, 0)
  assert.equal(await app.evaluate(({ app }) => app.isReady()), true)
  console.log('[e2e] titlebar menu / zoom / fullscreen / about / multi-window / close-to-tray OK')

  console.log('[e2e] PASS')
} finally {
  await app.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await app.close().catch(() => undefined)
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(appPid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(appPid)
    }
  } catch {
    /* already exited */
  }
  modelServer.close()
}
