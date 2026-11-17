import { createHash, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type {
  ReleaseNote,
  UpdateCheckResult,
  UpdateInfo,
  UpdateInstallProgress,
  WhatsNewData
} from '@shared/types'
import { APP_INTRO, APP_RELEASE_DATE } from '../shared/types'
import { compareVersions } from '../shared/version'

export { compareVersions }

const RELEASES_API =
  process.env.AGENTROLES_RELEASES_API ||
  'https://api.github.com/repos/Evanpatchouli/AgentRoles/releases/latest'
const RELEASES_LIST_API =
  process.env.AGENTROLES_RELEASES_LIST_API ||
  'https://api.github.com/repos/Evanpatchouli/AgentRoles/releases?per_page=20'
const RELEASES_PAGE = 'https://github.com/Evanpatchouli/AgentRoles/releases'
const CACHE_TTL = 6 * 60 * 60 * 1000
const CACHE_FILE = 'releases-cache.json'
const UPDATE_CACHE_FILE = 'update-check-cache.json'
/** 自动检查的最小间隔；手动检查会跳过此节流。 */
const UPDATE_CHECK_INTERVAL = 10 * 60 * 1000

interface ReleaseAsset {
  name?: string
  size?: number
  digest?: string
  browser_download_url?: string
}

export interface InstallerAsset {
  url: string
  size?: number
  sha256?: string
}

interface GitHubRelease {
  tag_name?: string
  name?: string
  published_at?: string
  html_url?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  assets?: ReleaseAsset[]
}

interface ReleaseCache {
  fetchedAt: number
  releases: ReleaseNote[]
}

interface UpdateCheckCache {
  checkedAt: number
  etag?: string
  release: GitHubRelease
}

export interface CheckUpdatesOptions {
  /** 缓存目录（通常是 userData）；未提供时不做缓存与节流。 */
  cacheDir?: string
  /** 跳过节流并立即发起条件请求，用于手动检查与安装前复核。 */
  force?: boolean
  /** 测试或私有部署可覆盖接口地址。 */
  apiUrl?: string
}

export interface WhatsNewOptions {
  cacheDir: string
  fallbackPath: string
  force?: boolean
}

function headers(currentVersion: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'AgentRoles/' + currentVersion
  }
}

function toReleaseNote(data: GitHubRelease): ReleaseNote | null {
  const version = String(data.tag_name || '').trim()
  if (!version) return null
  return {
    version,
    name: data.name || version,
    publishedAt: data.published_at || '',
    body: String(data.body || '').trim().slice(0, 20000),
    htmlUrl: data.html_url || RELEASES_PAGE,
    prerelease: Boolean(data.prerelease)
  }
}

function normalizeReleases(data: GitHubRelease[]): ReleaseNote[] {
  return data
    .filter((release) => !release.draft && !release.prerelease)
    .map(toReleaseNote)
    .filter((release): release is ReleaseNote => Boolean(release))
    .sort((a, b) => compareVersions(b.version, a.version))
}

async function readCache(cachePath: string): Promise<ReleaseCache | null> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ReleaseCache>
    if (!Array.isArray(parsed.releases)) return null
    return {
      fetchedAt: Number(parsed.fetchedAt) || 0,
      releases: parsed.releases
        .filter(
          (release): release is ReleaseNote =>
            Boolean(release?.version) && typeof release.body === 'string'
        )
        .sort((a, b) => compareVersions(b.version, a.version))
    }
  } catch {
    return null
  }
}

async function writeCache(cachePath: string, cache: ReleaseCache): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true })
    const tmp = cachePath + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8')
    await fs.rename(tmp, cachePath)
  } catch {
    /* cache is best-effort */
  }
}

function normalizeRelease(value: unknown): GitHubRelease | null {
  if (!value || typeof value !== 'object') return null
  const release = value as GitHubRelease
  const version = String(release.tag_name || '').trim()
  if (!version) return null
  return {
    ...release,
    tag_name: version,
    assets: Array.isArray(release.assets) ? release.assets : []
  }
}

async function readUpdateCache(cachePath: string): Promise<UpdateCheckCache | null> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<UpdateCheckCache>
    const release = normalizeRelease(parsed.release)
    if (!release) return null
    return {
      checkedAt: Number(parsed.checkedAt) || 0,
      ...(typeof parsed.etag === 'string' && parsed.etag ? { etag: parsed.etag } : {}),
      release
    }
  } catch {
    return null
  }
}

async function writeUpdateCache(cachePath: string, cache: UpdateCheckCache): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true })
    const tmp = cachePath + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(cache), 'utf8')
    await fs.rename(tmp, cachePath)
  } catch {
    /* cache is best-effort */
  }
}

function buildUpdateResult(
  currentVersion: string,
  release: GitHubRelease
): UpdateCheckResult {
  const latestVersion = String(release.tag_name || '').trim()
  if (!latestVersion) return { ok: false, message: 'Release 信息缺少版本号' }
  const assets = Array.isArray(release.assets) ? release.assets : []
  const installer = selectInstallerAsset(assets)
  const releaseUrl = release.html_url || RELEASES_PAGE
  return {
    ok: true,
    info: {
      currentVersion,
      latestVersion,
      publishedAt: release.published_at || '',
      releaseName: release.name || undefined,
      releaseUrl,
      downloadUrl: installer?.url || releaseUrl,
      ...(installer?.size === undefined ? {} : { downloadSize: installer.size }),
      ...(installer?.sha256 === undefined ? {} : { downloadSha256: installer.sha256 }),
      notes: (release.body || '').trim().slice(0, 1600) || undefined,
      hasUpdate: compareVersions(currentVersion, latestVersion) < 0
    }
  }
}

function cachedUpdateResult(
  currentVersion: string,
  cache: UpdateCheckCache
): UpdateCheckResult {
  return {
    ...buildUpdateResult(currentVersion, cache.release),
    cached: true,
    cachedAt: cache.checkedAt
  }
}

function isRateLimited(response: Response): boolean {
  return (
    response.status === 429 ||
    response.headers.get('x-ratelimit-remaining') === '0' ||
    response.headers.has('retry-after')
  )
}

function rateLimitMessage(response: Response): string {
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(reset) && reset > 0) {
    const at = new Date(reset * 1000).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
    return 'GitHub 接口请求已达上限（60 次/小时），预计 ' + at + ' 后恢复。'
  }
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return 'GitHub 接口请求过于频繁，请约 ' + Math.ceil(retryAfter / 60) + ' 分钟后重试。'
  }
  return 'GitHub 接口请求已达上限，请稍后再试。'
}

async function fetchReleases(currentVersion: string): Promise<ReleaseNote[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(RELEASES_LIST_API, {
      headers: headers(currentVersion),
      signal: controller.signal
    })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    const data = (await response.json()) as unknown
    if (!Array.isArray(data)) throw new Error('Release 列表格式异常')
    return normalizeReleases(data as GitHubRelease[])
  } finally {
    clearTimeout(timer)
  }
}

async function readFallback(
  fallbackPath: string,
  currentVersion: string
): Promise<ReleaseNote[]> {
  try {
    const raw = await fs.readFile(fallbackPath, 'utf8')
    const parsed = JSON.parse(raw) as { releases?: ReleaseNote[] } | ReleaseNote[]
    const list = Array.isArray(parsed) ? parsed : parsed.releases
    if (Array.isArray(list)) {
      const normalized = list
        .filter(
          (release): release is ReleaseNote =>
            Boolean(release?.version) && typeof release.body === 'string'
        )
        .sort((a, b) => compareVersions(b.version, a.version))
      if (normalized.length > 0) return normalized
    }
  } catch {
    /* use generated fallback */
  }
  return [
    {
      version: currentVersion,
      name: 'AgentRoles',
      publishedAt: APP_RELEASE_DATE,
      body: APP_INTRO,
      htmlUrl: RELEASES_PAGE,
      prerelease: false
    }
  ]
}

export async function getWhatsNew(
  currentVersion: string,
  options: WhatsNewOptions
): Promise<WhatsNewData> {
  const cachePath = path.join(options.cacheDir, CACHE_FILE)
  const cached = await readCache(cachePath)

  if (
    !options.force &&
    cached &&
    cached.releases.length > 0 &&
    Date.now() - cached.fetchedAt < CACHE_TTL
  ) {
    return {
      currentVersion,
      releases: cached.releases,
      source: 'cache',
      fetchedAt: cached.fetchedAt
    }
  }

  try {
    const releases = await fetchReleases(currentVersion)
    if (releases.length > 0) {
      const fetchedAt = Date.now()
      await writeCache(cachePath, { fetchedAt, releases })
      return {
        currentVersion,
        releases,
        source: 'github',
        fetchedAt
      }
    }
  } catch {
    /* fall through to cache / bundled changelog */
  }

  if (cached && cached.releases.length > 0) {
    return {
      currentVersion,
      releases: cached.releases,
      source: 'cache',
      fetchedAt: cached.fetchedAt
    }
  }

  return {
    currentVersion,
    releases: await readFallback(options.fallbackPath, currentVersion),
    source: 'bundled',
    fetchedAt: 0
  }
}

export async function checkForUpdates(
  currentVersion: string,
  options: CheckUpdatesOptions = {}
): Promise<UpdateCheckResult> {
  const apiUrl = options.apiUrl || RELEASES_API
  const cachePath = options.cacheDir
    ? path.join(options.cacheDir, UPDATE_CACHE_FILE)
    : null
  const cached = cachePath ? await readUpdateCache(cachePath) : null

  // 自动检查命中 10 分钟内的缓存时直接返回，避免高频启动消耗接口限额。
  if (!options.force && cached && Date.now() - cached.checkedAt < UPDATE_CHECK_INTERVAL) {
    return cachedUpdateResult(currentVersion, cached)
  }

  const requestHeaders = headers(currentVersion)
  if (cached?.etag) requestHeaders['If-None-Match'] = cached.etag

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(apiUrl, {
      headers: requestHeaders,
      signal: controller.signal
    })

    // 304 表示内容未变化，不消耗限额；刷新检查时间即可。
    if (response.status === 304) {
      if (!cached) return { ok: false, message: '检查更新失败（HTTP 304）' }
      const checkedAt = Date.now()
      const etag = response.headers.get('etag') || cached.etag
      const next: UpdateCheckCache = {
        checkedAt,
        release: cached.release,
        ...(etag ? { etag } : {})
      }
      if (cachePath) await writeUpdateCache(cachePath, next)
      return {
        ...buildUpdateResult(currentVersion, cached.release),
        cached: true,
        cachedAt: checkedAt
      }
    }

    if (response.status === 404) {
      return {
        ok: true,
        noRelease: true,
        message: '项目暂未发布 Release'
      }
    }

    if (!response.ok) {
      // 限额或服务异常时优先使用最近一次缓存，避免把可用的旧结果变成报错。
      if (cached) return cachedUpdateResult(currentVersion, cached)
      return {
        ok: false,
        message: isRateLimited(response)
          ? rateLimitMessage(response)
          : '检查更新失败（HTTP ' + response.status + '）'
      }
    }

    const release = normalizeRelease((await response.json()) as unknown)
    if (!release) {
      if (cached) return cachedUpdateResult(currentVersion, cached)
      return { ok: false, message: 'Release 信息缺少版本号' }
    }

    const checkedAt = Date.now()
    const etag = response.headers.get('etag') || undefined
    if (cachePath) {
      await writeUpdateCache(cachePath, {
        checkedAt,
        ...(etag ? { etag } : {}),
        release
      })
    }
    return buildUpdateResult(currentVersion, release)
  } catch (error) {
    if (cached) return cachedUpdateResult(currentVersion, cached)
    const aborted =
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'))
    return {
      ok: false,
      message: aborted
        ? '检查更新超时（20 秒）'
        : '检查更新失败：' + (error instanceof Error ? error.message : String(error))
    }
  } finally {
    clearTimeout(timer)
  }
}

/** GitHub Release 资产里的 SHA-256 摘要形如 `sha256:<64 位十六进制>`。 */
export function parseAssetDigest(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  const digest = normalized.startsWith('sha256:')
    ? normalized.slice('sha256:'.length)
    : normalized
  return /^[0-9a-f]{64}$/.test(digest) ? digest : undefined
}

/**
 * 选出用于自动更新的安装包资产：优先 setup/install 命名的 .exe，
 * 其次任意 .exe（与「前往下载」时代的规则一致）。
 */
export function selectInstallerAsset(assets: ReleaseAsset[]): InstallerAsset | undefined {
  const usable = assets.filter(
    (asset) => Boolean(asset.browser_download_url) && /^https:\/\//i.test(asset.browser_download_url || '')
  )
  const installer =
    usable.find(
      (asset) =>
        /\.exe$/i.test(asset.name || '') && /setup|install/i.test(asset.name || '')
    ) || usable.find((asset) => /\.exe$/i.test(asset.name || ''))
  if (!installer?.browser_download_url) return undefined
  return {
    url: installer.browser_download_url,
    ...(typeof installer.size === 'number' && installer.size > 0
      ? { size: installer.size }
      : {}),
    ...(parseAssetDigest(installer.digest) === undefined
      ? {}
      : { sha256: parseAssetDigest(installer.digest) })
  }
}

const MAX_INSTALLER_BYTES = 512 * 1024 * 1024
const PROGRESS_INTERVAL_MS = 150

export interface DownloadUpdateOptions {
  info: UpdateInfo
  /** 安装包落盘目录，由主进程用系统临时目录提供。 */
  targetDir: string
  signal?: AbortSignal
  onProgress?: (progress: UpdateInstallProgress) => void
}

export interface DownloadUpdateResult {
  ok: boolean
  path?: string
  canceled?: boolean
  message?: string
}

class UpdateDownloadAborted extends Error {
  constructor() {
    super('update download aborted')
    this.name = 'UpdateDownloadAborted'
  }
}

function isAllowedDownloadUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  // GitHub 的资产下载会跳转到 *.githubusercontent.com 的 CDN。
  return host === 'github.com' || host.endsWith('.githubusercontent.com')
}

function installerFileName(info: UpdateInfo): string {
  const fallback = 'AgentRoles.Setup.' + info.latestVersion + '.exe'
  let name = fallback
  try {
    const base = decodeURIComponent(new URL(info.downloadUrl).pathname.split('/').pop() || '')
    if (/\.exe$/i.test(base)) name = base
  } catch {
    /* keep fallback */
  }
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return safe || fallback
}

function abortError(): UpdateDownloadAborted {
  return new UpdateDownloadAborted()
}

/**
 * 下载、校验并落盘最新安装包。
 *
 * 校验规则：必须是 Release 资产声明的 https 地址、声明了 SHA-256 摘要、
 * 下载体积与摘要均匹配、文件头是 PE（MZ）。任一步失败都不会执行安装。
 */
export async function downloadUpdateInstaller(
  options: DownloadUpdateOptions
): Promise<DownloadUpdateResult> {
  const { info, targetDir, signal, onProgress } = options
  const version = info.latestVersion
  if (compareVersions(info.currentVersion, version) >= 0) {
    return { ok: false, message: '当前已是最新版本。' }
  }
  if (!isAllowedDownloadUrl(info.downloadUrl)) {
    return { ok: false, message: '更新下载地址不可信（仅接受 GitHub 的 https 地址）。' }
  }
  if (!info.downloadSha256) {
    return { ok: false, message: '发布资产缺少 SHA-256 摘要，无法校验安装包。' }
  }

  const fileName = installerFileName(info)
  const finalPath = path.join(targetDir, fileName)
  const partialPath = finalPath + '.partial'
  const hash = createHash('sha256')
  let received = 0
  let total = info.downloadSize
  let lastProgressAt = 0
  let firstBytes: Buffer | null = null
  let handle: FileHandle | null = null
  let completed = false

  const report = (phase: UpdateInstallProgress['phase'], bytes = received): void => {
    const now = Date.now()
    if (phase === 'downloading' && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
    lastProgressAt = now
    const percent =
      phase === 'downloading' && total && total > 0
        ? Math.min(100, Math.round((bytes / total) * 100))
        : undefined
    onProgress?.({
      phase,
      ...(phase === 'downloading' ? { received: bytes } : {}),
      ...(total === undefined ? {} : { total }),
      ...(percent === undefined ? {} : { percent })
    })
  }

  try {
    signal?.throwIfAborted()
    await fs.mkdir(targetDir, { recursive: true })
    await fs.rm(partialPath, { force: true })

    const response = await fetch(info.downloadUrl, {
      redirect: 'follow',
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal })
    })
    if (!response.ok) {
      return { ok: false, message: '下载安装包失败（HTTP ' + response.status + '）' }
    }
    if (!isAllowedDownloadUrl(response.url)) {
      return { ok: false, message: '更新下载被重定向到不可信地址，已中止。' }
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > 0) total = declared
    if (total !== undefined && total > MAX_INSTALLER_BYTES) {
      return { ok: false, message: '安装包体积异常，已中止下载。' }
    }
    if (!response.body) {
      return { ok: false, message: '更新服务返回了空的安装包。' }
    }

    handle = await fs.open(partialPath, 'w')
    const reader = response.body.getReader()
    try {
      while (true) {
        if (signal?.aborted) throw abortError()
        const chunk = await reader.read()
        if (chunk.done) break
        const data = Buffer.from(chunk.value)
        if (data.length === 0) continue
        received += data.length
        if (received > MAX_INSTALLER_BYTES) {
          throw new Error('安装包体积异常')
        }
        if (firstBytes === null) {
          firstBytes = Buffer.from(data.subarray(0, 2))
        }
        hash.update(data)
        await handle.write(data)
        report('downloading')
      }
    } finally {
      reader.releaseLock()
    }
    report('downloading', received)
    report('verifying')

    await handle.close()
    handle = null

    if (signal?.aborted) throw abortError()
    if (received === 0) {
      return { ok: false, message: '下载到的安装包为空，已中止。' }
    }
    if (total !== undefined && received !== total) {
      return {
        ok: false,
        message: '安装包大小与发布信息不一致（' + received + ' / ' + total + ' 字节），已中止。'
      }
    }
    const actual = hash.digest()
    const expected = Buffer.from(info.downloadSha256, 'hex')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return { ok: false, message: '安装包校验失败（SHA-256 不匹配），已中止安装。' }
    }
    if (!firstBytes || firstBytes.toString('latin1') !== 'MZ') {
      return { ok: false, message: '下载内容不是有效的 Windows 安装程序，已中止。' }
    }

    await fs.rename(partialPath, finalPath)
    completed = true
    return { ok: true, path: finalPath }
  } catch (error) {
    if (signal?.aborted || error instanceof UpdateDownloadAborted) {
      return { ok: false, canceled: true, message: '已取消更新下载' }
    }
    return {
      ok: false,
      message: '下载安装包失败：' + (error instanceof Error ? error.message : String(error))
    }
  } finally {
    try {
      if (handle !== null) await handle.close()
    } catch {
      /* ignore close failure */
    }
    if (!completed) {
      await fs.rm(partialPath, { force: true }).catch(() => undefined)
    }
  }
}

