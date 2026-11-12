import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') }

interface PackageMeta {
  version?: string
  releaseDate?: string
}

function readPackageMeta(): PackageMeta {
  try {
    return JSON.parse(
      readFileSync(resolve(__dirname, 'package.json'), 'utf8')
    ) as PackageMeta
  } catch {
    return {}
  }
}

function localDateString(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

/**
 * 发版日期以 package.json 的 releaseDate 为准，构建时注入到主进程与渲染进程。
 * 没有配置时回退到构建当天，避免旧仓库或临时构建拿不到值。
 */
function resolveReleaseDate(pkg: PackageMeta): string {
  const configured = String(pkg.releaseDate ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(configured)) return configured
  if (configured) {
    console.warn(
      '[build] package.json releaseDate 需要是 YYYY-MM-DD，已回退到构建当天：' +
        configured
    )
  }
  return localDateString(new Date())
}

const packageMeta = readPackageMeta()
const define = {
  __APP_RELEASE_DATE__: JSON.stringify(resolveReleaseDate(packageMeta))
}

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
    define
  },
  preload: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
    define
  },
  renderer: {
    resolve: { alias: sharedAlias },
    plugins: [react()],
    define
  }
})
