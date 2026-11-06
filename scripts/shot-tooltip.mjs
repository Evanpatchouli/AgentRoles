import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroles-shot-'))
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    AGENTROLES_USER_DATA: userData,
    AGENTROLES_VIEW: 'agents',
    AGENTROLES_TAB: 'model'
  }
})
const appPid = app.process().pid
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.info-tip-trigger', { timeout: 20000 })
  await page.locator('.info-tip-trigger').hover()
  await page.waitForSelector('.info-tip-popover')
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(process.cwd(), 'docs/assets/tooltip.png') })
  console.log('saved docs/assets/tooltip.png')
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
