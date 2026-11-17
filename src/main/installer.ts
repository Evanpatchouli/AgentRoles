import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

/** 安装包落盘目录：系统临时目录下的独立子目录。 */
export function updateDownloadDir(): string {
  return path.join(os.tmpdir(), 'agentroles-update')
}

/**
 * 以静默升级方式启动 NSIS 安装程序。
 *
 * - `/S`：静默安装，不显示向导页
 * - `--updated`：跳过「应用正在运行」检查，沿用原安装目录
 * - `--force-run`：安装完成后重新启动 AgentRoles
 */
export async function launchUpdateInstaller(installerPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const child = spawn(installerPath, ['/S', '--updated', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('error', (error) => {
      if (settled) {
        console.error('[update] 安装程序启动后出错', error)
        return
      }
      settled = true
      reject(error)
    })
    child.once('spawn', () => {
      if (settled) return
      settled = true
      child.unref()
      resolve()
    })
  })
}
