import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import type { UpdateInfo } from '../src/shared/types'
import {
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
  console.log('[update] PASS')
}

void runInstallGuards().catch((error) => {
  console.error(error)
  process.exit(1)
})
