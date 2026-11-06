import type { UpdateCheckResult } from '@shared/types'

const RELEASES_API =
  process.env.AGENTROLES_RELEASES_API ||
  'https://api.github.com/repos/Evanpatchouli/AgentRoles/releases/latest'
const RELEASES_PAGE = 'https://github.com/Evanpatchouli/AgentRoles/releases'

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
  assets?: ReleaseAsset[]
}

function parseVersion(version: string): { core: number[]; pre: string[] } {
  const cleaned = version.trim().replace(/^v/i, '').split('+')[0]
  const dash = cleaned.indexOf('-')
  const coreText = dash >= 0 ? cleaned.slice(0, dash) : cleaned
  const preText = dash >= 0 ? cleaned.slice(dash + 1) : ''
  return {
    core: coreText.split('.').map((part) => {
      const value = Number(part)
      return Number.isFinite(value) ? value : 0
    }),
    pre: preText ? preText.split('.') : []
  }
}

/** 语义化版本比较：v 前缀、alpha/beta/rc 等预发布标识均支持。 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  const length = Math.max(a.core.length, b.core.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (diff !== 0) return diff
  }

  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1

  const preLength = Math.max(a.pre.length, b.pre.length)
  for (let index = 0; index < preLength; index += 1) {
    const leftPart = a.pre[index]
    const rightPart = b.pre[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) {
      const diff = Number(leftPart) - Number(rightPart)
      if (diff !== 0) return diff
    } else if (leftNumeric) {
      return -1
    } else if (rightNumeric) {
      return 1
    } else if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1
    }
  }
  return 0
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'AgentRoles/' + currentVersion
      },
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
