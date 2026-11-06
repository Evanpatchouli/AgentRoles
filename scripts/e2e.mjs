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
const ingressPort = 43177

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
  let body = ''
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    const payload = JSON.parse(body || '{}')
    const messages = Array.isArray(payload.messages) ? payload.messages : []
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
  env: { ...process.env, AGENTROLES_USER_DATA: userData }
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
  assert.equal(memory.project, 'AgentRoles')
  console.log('[e2e] memory skill executed')

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
