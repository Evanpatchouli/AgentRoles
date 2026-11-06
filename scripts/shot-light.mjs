import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroles-light-'))
const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: {
    ...process.env,
    AGENTROLES_USER_DATA: userData,
    AGENTROLES_VIEW: 'agents',
    AGENTROLES_TAB: 'chat'
  }
})
const appPid = app.process().pid
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.theme-option[data-theme-option="light"]', { timeout: 20000 })
  await page.locator('.theme-option[data-theme-option="light"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.waitForTimeout(350)

  const shots = [
    ['light-chat', async () => {}],
    ['light-skills', async () => page.locator('.tab').filter({ hasText: '技能' }).click()],
    ['light-role', async () => page.locator('.tab').filter({ hasText: '角色' }).click()],
    ['light-model', async () => page.locator('.tab').filter({ hasText: '模型' }).click()],
    ['light-inbox', async () => page.locator('.nav-item').filter({ hasText: '收件箱' }).click()],
    ['light-settings', async () => page.locator('.nav-item').filter({ hasText: '设置' }).click()]
  ]
  for (const [name, action] of shots) {
    await action()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(root, 'screenshots', name + '.png') })
    console.log('saved', name)
  }

  await page.locator('.theme-option[data-theme-option="dark"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.locator('.nav-item').filter({ hasText: '工作台' }).click()
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(root, 'screenshots', 'dark-check.png') })
  console.log('saved dark-check')
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
