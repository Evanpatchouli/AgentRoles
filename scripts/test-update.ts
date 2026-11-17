import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { UpdateInfo } from '../src/shared/types'
import {
  checkForUpdates,
  compareVersions,
  downloadUpdateInstaller,
  parseAssetDigest,
  selectInstallerAsset
} from '../src/main/update'

assert.ok(compareVersions('0.1.0', 'v0.1.1') < 0)
assert.ok(compareVersions('v1.2.3', '1.2.2') > 0)
assert.equal(compareVersions('1.2.3', 'v1.2.3'), 0)
assert.ok(compareVersions('1.0.0-beta.1', '1.0.0-beta.2') < 0)
assert.ok(compareVersions('1.0.0-rc.1', '1.0.0-beta.9') > 0)
assert.ok(compareVersions('1.0.0-beta', '1.0.0') < 0)
assert.equal(compareVersions('1.0.0+build.2', '1.0.0+build.1'), 0)

const digest = 'a'.repeat(64)
assert.equal(parseAssetDigest('sha256:' + digest), digest)
assert.equal(parseAssetDigest('SHA256:' + digest.toUpperCase()), digest)
assert.equal(parseAssetDigest(digest), digest)
assert.equal(parseAssetDigest('sha256:not-a-digest'), undefined)
assert.equal(parseAssetDigest(undefined), undefined)

const setupAsset = {
  name: 'AgentRoles.Setup.0.1.3.exe',
  size: 12345,
  digest: 'sha256:' + digest,
  browser_download_url:
    'https://github.com/Evanpatchouli/AgentRoles/releases/download/v0.1.3/AgentRoles.Setup.0.1.3.exe'
}
const blockmapAsset = {
  name: 'AgentRoles.Setup.0.1.3.exe.blockmap',
  size: 100,
  digest: 'sha256:' + 'b'.repeat(64),
  browser_download_url: setupAsset.browser_download_url + '.blockmap'
}

const selected = selectInstallerAsset([blockmapAsset, setupAsset])
assert.ok(selected)
assert.equal(selected.url, setupAsset.browser_download_url)
assert.equal(selected.size, 12345)
assert.equal(selected.sha256, digest)

const fallback = selectInstallerAsset([
  { name: 'AgentRoles-0.1.3.exe', browser_download_url: 'https://github.com/x/y.exe' }
])
assert.ok(fallback)
assert.equal(fallback.url, 'https://github.com/x/y.exe')

assert.equal(
  selectInstallerAsset([
    { name: 'AgentRoles.Setup.0.1.3.exe', browser_download_url: 'http://github.com/x.exe' }
  ]),
  undefined
)
assert.equal(selectInstallerAsset([blockmapAsset]), undefined)

const baseInfo: UpdateInfo = {
  currentVersion: '0.1.2',
  latestVersion: '0.1.3',
  publishedAt: '2026-11-17T00:00:00Z',
  releaseUrl: 'https://github.com/Evanpatchouli/AgentRoles/releases/tag/v0.1.3',
  downloadUrl: setupAsset.browser_download_url,
  downloadSize: 12345,
  downloadSha256: digest,
  hasUpdate: true
}
async function runInstallGuards(): Promise<void> {
  const targetDir = path.join(os.tmpdir(), 'agentroles-test-update-' + process.pid)

  const insecure = await downloadUpdateInstaller({
    info: { ...baseInfo, downloadUrl: 'http://github.com/x.exe' },
    targetDir
  })
  assert.equal(insecure.ok, false)
  assert.match(String(insecure.message), /不可信/)

  const noDigest = await downloadUpdateInstaller({
    info: { ...baseInfo, downloadSha256: undefined },
    targetDir
  })
  assert.equal(noDigest.ok, false)
  assert.match(String(noDigest.message), /SHA-256/)

  const upToDate = await downloadUpdateInstaller({
    info: { ...baseInfo, currentVersion: '0.1.3' },
    targetDir
  })
  assert.equal(upToDate.ok, false)
  assert.match(String(upToDate.message), /最新版本/)

  // 只校验纯函数与本地守门逻辑；真实下载与安装由发布后的手工验证覆盖。
  console.log('[update] semantic version comparison OK')
  console.log('[update] installer asset selection + digest gate OK')
  console.log('[update] install preflight guards OK')
}

async function runCacheChecks(): Promise<void> {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentroles-update-cache-'))
  const emptyCacheDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agentroles-update-cache-empty-')
  )
  const cacheFile = path.join(cacheDir, 'update-check-cache.json')
  let etag = '"release-v1"'
  let mode: 'ok' | 'rate-limit' | 'error' = 'ok'
  let hits = 0
  let conditionalHits = 0
  const payload = {
    tag_name: 'v0.1.6',
    name: 'AgentRoles v0.1.6',
    published_at: '2026-11-17T00:00:00Z',
    html_url: 'https://github.com/Evanpatchouli/AgentRoles/releases/tag/v0.1.6',
    body: '### 改进\n\n- 检查更新缓存',
    assets: [setupAsset]
  }
  const server = http.createServer((request, response) => {
    hits += 1
    if (request.headers['if-none-match'] === etag) {
      conditionalHits += 1
      response.writeHead(304, { ETag: etag })
      response.end()
      return
    }
    if (mode === 'rate-limit') {
      response.writeHead(403, {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': '60',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 600)
      })
      response.end(JSON.stringify({ message: 'API rate limit exceeded' }))
      return
    }
    if (mode === 'error') {
      response.writeHead(500)
      response.end('boom')
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json', ETag: etag })
    response.end(JSON.stringify(payload))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const apiUrl = 'http://127.0.0.1:' + port + '/releases/latest'

  try {
    const first = await checkForUpdates('0.1.5', { cacheDir, apiUrl })
    assert.equal(first.ok, true)
    assert.equal(first.info?.latestVersion, 'v0.1.6')
    assert.equal(first.cached, undefined)
    assert.equal(hits, 1)
    const cache = JSON.parse(await fs.readFile(cacheFile, 'utf8')) as {
      etag?: string
      checkedAt?: number
    }
    assert.equal(cache.etag, etag)
    assert.ok(Number(cache.checkedAt) > 0)

    const throttled = await checkForUpdates('0.1.5', { cacheDir, apiUrl })
    assert.equal(throttled.ok, true)
    assert.equal(throttled.cached, true)
    assert.equal(hits, 1)

    const revalidated = await checkForUpdates('0.1.5', { cacheDir, apiUrl, force: true })
    assert.equal(revalidated.ok, true)
    assert.equal(revalidated.cached, true)
    assert.equal(hits, 2)
    assert.equal(conditionalHits, 1)

    await checkForUpdates('0.1.5', { cacheDir, apiUrl })
    assert.equal(hits, 2)

    // 内容变化 + 限额：ETag 不匹配，返回 403 时回退到缓存。
    etag = '"release-v2"'
    mode = 'rate-limit'
    const limited = await checkForUpdates('0.1.5', { cacheDir, apiUrl, force: true })
    assert.equal(limited.ok, true)
    assert.equal(limited.cached, true)
    assert.equal(limited.info?.latestVersion, 'v0.1.6')

    const noCache = await checkForUpdates('0.1.5', {
      cacheDir: emptyCacheDir,
      apiUrl,
      force: true
    })
    assert.equal(noCache.ok, false)
    assert.match(String(noCache.message), /上限/)
    assert.match(String(noCache.message), /恢复|分钟/)

    mode = 'error'
    const fallback = await checkForUpdates('0.1.5', { cacheDir, apiUrl, force: true })
    assert.equal(fallback.ok, true)
    assert.equal(fallback.cached, true)

    console.log('[update] ETag conditional request + 304 OK')
    console.log('[update] local cache throttle + cached fallback OK')
    console.log('[update] rate limit message with reset time OK')
  } finally {
    server.close()
    await fs.rm(cacheDir, { recursive: true, force: true })
    await fs.rm(emptyCacheDir, { recursive: true, force: true })
  }
}

void (async () => {
  await runInstallGuards()
  await runCacheChecks()
  console.log('[update] PASS')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
