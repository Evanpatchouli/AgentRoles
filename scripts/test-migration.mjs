import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroles-migrate-'))
const workspace = path.join(userData, 'workspace')
fs.mkdirSync(path.join(userData, 'messages'), { recursive: true })
fs.mkdirSync(workspace, { recursive: true })

const agent = {
  id: 'legacy-agent',
  name: '旧版记录员',
  avatar: '◈',
  color: '#c9f36b',
  tagline: '兼容旧数据',
  role: '记录消息。',
  model: {
    provider: 'openai',
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: '',
    model: 'legacy-model',
    temperature: 0.4,
    maxTokens: 1024
  },
  skills: {
    memory: { enabled: true, settings: {} },
    notion: { enabled: false, settings: {} }
  },
  autoRun: false,
  createdAt: 1700000000000,
  updatedAt: 1700000000000
}

fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify({
    version: 1,
    agents: [agent],
    settings: {
      notion: { token: '', databaseId: '' },
      ingress: { enabled: false, port: 43198, token: 'legacy-token' },
      workspaceDir: workspace,
      theme: 'dark'
    }
  })
)

fs.writeFileSync(
  path.join(userData, 'messages', 'legacy-agent.json'),
  JSON.stringify([
    {
      id: 'legacy-user',
      agentId: 'legacy-agent',
      role: 'user',
      content: '迁移后的历史会话',
      state: 'done',
      source: 'app',
      createdAt: 1700000001000
    },
    {
      id: 'legacy-assistant',
      agentId: 'legacy-agent',
      role: 'assistant',
      content: '已记录。',
      state: 'done',
      createdAt: 1700000002000
    }
  ])
)

const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: { ...process.env, AGENTROLES_USER_DATA: userData, AGENTROLES_VIEW: 'agents' }
})
const appPid = app.process().pid
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.msg-user', { timeout: 20000 })
  const snapshot = await page.evaluate(async () => ({
    state: await window.api.getState(),
    messages: await window.api.getMessages('legacy-agent')
  }))
  assert.equal(snapshot.state.sessions.length, 1)
  assert.equal(snapshot.state.sessions[0].id, 'legacy-agent')
  assert.ok(snapshot.state.sessions[0].title.includes('迁移后的历史会话'))
  assert.equal(snapshot.messages[0].sessionId, 'legacy-agent')
  assert.ok((await page.locator('.session-title').innerText()).includes('迁移后的历史会话'))
  console.log('[migration] legacy single-thread history -> default session OK')
  console.log('[migration] PASS')
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
  fs.rmSync(userData, { recursive: true, force: true })
}
