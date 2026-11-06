import fs from 'node:fs/promises'
import path from 'node:path'
import type { ReleaseNote, UpdateCheckResult, WhatsNewData } from '@shared/types'
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

interface ReleaseAsset {
  name?: string
  browser_download_url?: string
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

export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(RELEASES_API, {
      headers: headers(currentVersion),
      signal: controller.signal
    })

    if (response.status === 404) {
      return {
        ok: true,
        noRelease: true,
        message: '项目暂未发布 Release'
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        message: '检查更新失败（HTTP ' + response.status + '）'
      }
    }

    const data = (await response.json()) as GitHubRelease
    const latestVersion = String(data.tag_name || '').trim()
    if (!latestVersion) {
      return { ok: false, message: 'Release 信息缺少版本号' }
    }

    const assets = Array.isArray(data.assets) ? data.assets : []
    const installer =
      assets.find(
        (asset) =>
          /\.exe$/i.test(asset.name || '') &&
          /setup|install/i.test(asset.name || '') &&
          Boolean(asset.browser_download_url)
      ) ||
      assets.find(
        (asset) => /\.exe$/i.test(asset.name || '') && Boolean(asset.browser_download_url)
      )
    const releaseUrl = data.html_url || RELEASES_PAGE

    return {
      ok: true,
      info: {
        currentVersion,
        latestVersion,
        publishedAt: data.published_at || '',
        releaseName: data.name || undefined,
        releaseUrl,
        downloadUrl: installer?.browser_download_url || releaseUrl,
        notes: (data.body || '').trim().slice(0, 1600) || undefined,
        hasUpdate: compareVersions(currentVersion, latestVersion) < 0
      }
    }
  } catch (error) {
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
