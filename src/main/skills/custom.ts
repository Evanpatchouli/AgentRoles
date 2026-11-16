import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Agent, SkillMeta } from '@shared/types'
import type { ToolContext, ToolSpec } from './types'
import { json, strArg, truncate } from './types'
import { parseSkillMarkdown } from './frontmatter'
import { readZipArchive } from './zip'

/**
 * 自定义技能包（SKILL.md + 参考文件 + 脚本）。
 *
 * 技能包存放在 <userData>/skills/<slug>/，对所有角色可见；
 * 每个角色通过 Agent.skills[id].enabled 独立启停。
 */

const SKILL_FILE = 'SKILL.md'
const META_FILE = '.agentroles.json'
const SKIP_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', '__pycache__', '.venv', 'venv'])
const MAX_FILES = 2000
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
const MAX_PROMPT_CHARS = 24000
const PROMPT_FILE_LIMIT = 40
const SCRIPT_EXTENSIONS = new Set([
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.sh',
  '.ps1',
  '.bat',
  '.cmd',
  '.rb'
])

const CUSTOM_SKILL_TOOLS = ['skill_list', 'skill_read']

interface Sidecar {
  id?: string
  source?: 'local' | 'url'
  origin?: string
  importedAt?: number
}

export interface ImportedSkill {
  meta: SkillMeta
  dir: string
  body: string
  files: string[]
  scripts: string[]
  source: 'local' | 'url'
  origin: string
}

interface ImportSource {
  source: 'local' | 'url'
  origin: string
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

function slugify(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  if (normalized) return normalized
  return 'skill-' + createHash('sha1').update(value).digest('hex').slice(0, 10)
}

function resolveInside(root: string, target: string): string {
  const resolved = path.resolve(root, target || '.')
  const relative = path.relative(root, resolved)
  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('路径越界：只能访问技能包内的文件')
  }
  return resolved
}

function shouldSkipDirectory(name: string): boolean {
  return SKIP_DIRS.has(name)
}

async function collectDirectory(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  let totalBytes = 0

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name === META_FILE) continue
      const stat = await fs.stat(full)
      if (stat.size > MAX_FILE_BYTES) {
        console.warn('[skills] 跳过过大文件', full, stat.size)
        continue
      }
      if (files.size + 1 > MAX_FILES) {
        throw new Error('技能包文件过多（上限 ' + MAX_FILES + ' 个）')
      }
      if (totalBytes + stat.size > MAX_TOTAL_BYTES) {
        throw new Error('技能包总大小超过上限（64MB）')
      }
      files.set(toPosix(path.relative(root, full)), await fs.readFile(full))
      totalBytes += stat.size
    }
  }

  await walk(root)
  return files
}

async function listDirectoryFiles(root: string): Promise<string[]> {
  const output: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue
        await walk(full)
        continue
      }
      if (!entry.isFile() || entry.name === META_FILE) continue
      output.push(toPosix(path.relative(root, full)))
      if (output.length >= MAX_FILES) return
    }
  }
  await walk(root)
  return output.sort()
}

function skillCandidates(files: Map<string, Buffer>): string[] {
  return [...files.keys()].filter((name) => name === SKILL_FILE || name.endsWith('/' + SKILL_FILE))
}

function pickSkillFile(files: Map<string, Buffer>, subdir?: string): string {
  const candidates = skillCandidates(files)
  if (candidates.length === 0) {
    throw new Error('技能包里没有找到 SKILL.md（技能包根目录必须包含 SKILL.md）')
  }
  let scoped = candidates
  if (subdir) {
    const normalized = subdir.replace(/^\/+|\/+$/g, '')
    scoped = candidates.filter((name) => {
      const dir = name.slice(0, -(SKILL_FILE.length + 1))
      return dir === normalized || dir.endsWith('/' + normalized)
    })
    if (scoped.length === 0) {
      throw new Error('指定子目录下没有 SKILL.md：' + subdir)
    }
  }
  const ranked = scoped
    .map((name) => ({ name, depth: name.split('/').length }))
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
  const shallowest = ranked[0].depth
  const top = ranked.filter((item) => item.depth === shallowest)
  if (top.length > 1) {
    throw new Error(
      '来源里包含多个技能包，请在链接中指定子目录：' +
        top
          .slice(0, 5)
          .map((item) => item.name)
          .join('、')
    )
  }
  return top[0].name
}

function rebase(files: Map<string, Buffer>, skillFile: string): Map<string, Buffer> {
  const base = skillFile === SKILL_FILE ? '' : skillFile.slice(0, -(SKILL_FILE.length + 1))
  if (!base) return files
  const prefix = base + '/'
  const output = new Map<string, Buffer>()
  for (const [name, data] of files) {
    if (!name.startsWith(prefix)) continue
    output.set(name.slice(prefix.length), data)
  }
  return output
}

function detectScripts(files: string[]): string[] {
  return files.filter((name) => SCRIPT_EXTENSIONS.has(path.extname(name).toLowerCase()))
}

function readSidecar(raw: string | null): Sidecar {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Sidecar
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function githubZipSource(
  value: string
): { zipUrl: string; subdir?: string; name: string } | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('请输入有效的 http(s) 链接')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http(s) 链接')
  }
  const host = url.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]
  let repo = parts[1]
  if (repo.endsWith('.git')) repo = repo.slice(0, -4)
  let ref = ''
  let subdir = ''
  const mode = parts[2]
  if (mode === 'tree' || mode === 'blob') {
    ref = parts[3] ?? ''
    subdir = parts.slice(4).join('/')
  }
  if (subdir && subdir.endsWith('/' + SKILL_FILE)) {
    subdir = subdir.slice(0, -(SKILL_FILE.length + 1))
  }
  const encodedRef = ref
    ? '/' + ref.split('/').map((segment) => encodeURIComponent(segment)).join('/')
    : ''
  return {
    zipUrl: 'https://api.github.com/repos/' + owner + '/' + repo + '/zipball' + encodedRef,
    name: subdir ? path.posix.basename(subdir) : repo,
    ...(subdir ? { subdir } : {})
  }
}

function sourceFromUrl(value: string): { zipUrl: string; subdir?: string; name: string } {
  const git = githubZipSource(value)
  if (git) return git
  let name = '导入的技能'
  try {
    const url = new URL(value)
    const base = path.posix.basename(url.pathname)
    if (base) name = base.replace(/\.zip$/i, '') || name
  } catch {
    /* 由下载阶段给出更具体的错误 */
  }
  return { zipUrl: value.trim(), name }
}

function promptFileSummary(files: string[]): string {
  const others = files.filter((name) => name !== SKILL_FILE)
  if (others.length === 0) return '（仅 SKILL.md）'
  const listed = others.slice(0, PROMPT_FILE_LIMIT)
  const suffix =
    others.length > listed.length ? '…（共 ' + others.length + ' 个文件）' : ''
  return listed.join('、') + suffix
}

export function customSkillPrompt(skill: ImportedSkill): string {
  const lines: string[] = []
  lines.push('### ' + skill.meta.name + '（' + skill.meta.id + '）')
  if (skill.meta.description) lines.push(skill.meta.description)
  lines.push('- 技能目录：' + skill.dir)
  lines.push('- 包内文件：' + promptFileSummary(skill.files))
  lines.push(
    '- 读取包内参考文件：调用 skill_read（skill="' +
      skill.meta.id +
      '"，path 为相对路径），需要目录时调用 skill_list。'
  )
  if (skill.scripts.length > 0) {
    lines.push(
      '- 包内含脚本（' +
        skill.scripts.slice(0, 6).join('、') +
        '）。运行脚本需要该角色同时启用「终端命令」技能；请用绝对路径调用，Windows 上 python 命令通常是 python，macOS/Linux 上通常是 python3。执行前先确认脚本路径。'
    )
  }
  lines.push('')
  if (skill.body.length > MAX_PROMPT_CHARS) {
    lines.push(skill.body.slice(0, MAX_PROMPT_CHARS))
    lines.push(
      '',
      '（技能说明过长，已截断。完整内容请用 skill_read 读取 SKILL.md。）'
    )
  } else {
    lines.push(skill.body)
  }
  return lines.join('\n')
}

export function enabledCustomSkills(
  library: CustomSkillLibrary,
  agent: Agent
): ImportedSkill[] {
  return library.list().filter((skill) => agent.skills[skill.meta.id]?.enabled)
}

function enabledSkill(
  library: CustomSkillLibrary,
  ctx: ToolContext,
  key: string
): ImportedSkill {
  const value = key.trim()
  if (!value) throw new Error('skill 不能为空，请传技能 id 或名称')
  const skill = library.find(value)
  if (!skill) throw new Error('技能不存在：' + value)
  if (!ctx.agent.skills[skill.meta.id]?.enabled) {
    throw new Error('技能「' + skill.meta.name + '」没有在当前角色启用')
  }
  return skill
}

export function customSkillTools(library: CustomSkillLibrary): ToolSpec[] {
  return [
    {
      name: 'skill_list',
      description: '列出当前角色已启用技能包内的文件与子目录。',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: '技能 id 或名称' },
          path: { type: 'string', description: '相对技能目录的路径，留空为根目录' }
        },
        required: ['skill']
      },
      async execute(args, ctx) {
        const skill = enabledSkill(library, ctx, strArg(args, 'skill'))
        const target = resolveInside(skill.dir, strArg(args, 'path'))
        const entries = await fs.readdir(target, { withFileTypes: true })
        const items = []
        for (const entry of entries.slice(0, 300)) {
          if (entry.name === META_FILE) continue
          const info = await fs.stat(path.join(target, entry.name)).catch(() => null)
          items.push({
            name: entry.name,
            type: entry.isDirectory() ? 'dir' : 'file',
            size: info?.size ?? 0
          })
        }
        return json({
          skill: skill.meta.id,
          root: skill.dir,
          path: path.relative(skill.dir, target) || '.',
          entries: items
        })
      }
    },
    {
      name: 'skill_read',
      description: '读取当前角色已启用技能包内的文本文件（说明书、参考文档、脚本源码等）。',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: '技能 id 或名称' },
          path: { type: 'string', description: '相对技能目录的文件路径' },
          offset: { type: 'number', description: '起始行号，从 1 开始，可选' },
          limit: { type: 'number', description: '最多读取行数，默认 400，最大 2000' }
        },
        required: ['skill', 'path']
      },
      async execute(args, ctx) {
        const skill = enabledSkill(library, ctx, strArg(args, 'skill'))
        const relative = strArg(args, 'path').trim()
        if (!relative) throw new Error('path 不能为空')
        const target = resolveInside(skill.dir, relative)
        const stat = await fs.stat(target)
        if (stat.isDirectory()) throw new Error('这是一个目录，请用 skill_list 查看内容')
        if (stat.size > 2 * 1024 * 1024) throw new Error('文件过大（上限 2MB），请读取更具体的文件')
        const raw = await fs.readFile(target)
        if (raw.includes(0)) throw new Error('这是一个二进制文件，无法按文本读取')
        const text = raw.toString('utf8')
        const offset = Math.max(1, Number(args.offset) || 1)
        const limit = Math.min(2000, Math.max(1, Number(args.limit) || 400))
        const lines = text.split(/\r?\n/)
        return json({
          skill: skill.meta.id,
          path: path.relative(skill.dir, target).split(path.sep).join('/'),
          totalLines: lines.length,
          offset,
          content: truncate(lines.slice(offset - 1, offset - 1 + limit).join('\n'), 60000)
        })
      }
    }
  ]
}

export class CustomSkillLibrary {
  private skills = new Map<string, ImportedSkill>()

  constructor(private readonly rootDir: string) {}

  async load(): Promise<void> {
    this.skills.clear()
    await fs.mkdir(this.rootDir, { recursive: true })
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = path.join(this.rootDir, entry.name)
      try {
        const skill = await this.loadFromDir(dir)
        this.skills.set(skill.meta.id, skill)
      } catch (error) {
        console.error('[skills] 跳过无法读取的技能包', dir, error)
      }
    }
  }

  list(): ImportedSkill[] {
    return [...this.skills.values()].sort(
      (a, b) =>
        (a.meta.importedAt ?? 0) - (b.meta.importedAt ?? 0) ||
        a.meta.name.localeCompare(b.meta.name)
    )
  }

  metas(): SkillMeta[] {
    return this.list().map((skill) => skill.meta)
  }

  get(id: string): ImportedSkill | undefined {
    return this.skills.get(id)
  }

  find(idOrName: string): ImportedSkill | undefined {
    const value = idOrName.trim()
    const direct = this.skills.get(value)
    if (direct) return direct
    const lower = value.toLowerCase()
    return this.list().find(
      (skill) =>
        skill.meta.name.toLowerCase() === lower ||
        skill.meta.id.toLowerCase() === lower
    )
  }

  async importFolder(sourceDir: string): Promise<ImportedSkill> {
    const root = path.resolve(sourceDir)
    const stat = await fs.stat(root).catch(() => null)
    if (!stat || !stat.isDirectory()) throw new Error('请选择一个技能文件夹')
    const files = await collectDirectory(root)
    if (!files.has(SKILL_FILE)) {
      throw new Error('所选文件夹根部没有 SKILL.md，请选择技能包根目录')
    }
    return this.install(files, { source: 'local', origin: root }, path.basename(root))
  }

  async importUrl(rawUrl: string): Promise<ImportedSkill> {
    const value = rawUrl.trim()
    if (!value) throw new Error('请输入技能包地址')
    const source = sourceFromUrl(value)
    let response: Response
    try {
      response = await fetch(source.zipUrl, {
        headers: {
          'User-Agent': 'AgentRoles',
          Accept: 'application/vnd.github+json, application/zip'
        },
        signal: AbortSignal.timeout(90000)
      })
    } catch (error: any) {
      throw new Error('下载技能包失败：' + (error?.message ?? String(error)))
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200)
      throw new Error('下载技能包失败（HTTP ' + response.status + '）：' + detail)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_DOWNLOAD_BYTES) {
      throw new Error('技能包超过下载大小上限（64MB）')
    }
    const entries = readZipArchive(buffer, {
      maxEntries: MAX_FILES,
      maxEntryBytes: MAX_FILE_BYTES,
      maxTotalBytes: MAX_TOTAL_BYTES
    })
    const files = new Map<string, Buffer>()
    for (const entry of entries) {
      if (entry.isDirectory) continue
      if (entry.name === META_FILE) continue
      if (entry.name.split('/').some((segment) => shouldSkipDirectory(segment))) continue
      files.set(entry.name, entry.data)
    }
    const skillFile = pickSkillFile(files, source.subdir)
    return this.install(
      rebase(files, skillFile),
      { source: 'url', origin: value },
      source.name
    )
  }

  async remove(id: string): Promise<boolean> {
    const skill = this.skills.get(id)
    if (!skill) return false
    await fs.rm(skill.dir, { recursive: true, force: true })
    this.skills.delete(id)
    return true
  }

  private async install(
    rawFiles: Map<string, Buffer>,
    source: ImportSource,
    fallbackName: string
  ): Promise<ImportedSkill> {
    const files = new Map(rawFiles)
    const skillFile = pickSkillFile(files)
    const rebased = rebase(files, skillFile)
    const markdown = rebased.get(SKILL_FILE)
    if (!markdown) throw new Error('技能包里没有找到 SKILL.md')
    const document = parseSkillMarkdown(markdown.toString('utf8'), fallbackName)
    if (!document.name.trim()) throw new Error('SKILL.md 缺少 name')
    const slug = slugify(document.name)
    const id = 'custom:' + slug
    const target = path.join(this.rootDir, slug)
    const temp = path.join(this.rootDir, '.import-' + randomUUID())

    try {
      await fs.mkdir(temp, { recursive: true })
      for (const [name, data] of rebased) {
        const destination = path.join(temp, ...name.split('/'))
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.writeFile(destination, data)
      }
      const sidecar: Sidecar = {
        id,
        source: source.source,
        origin: source.origin,
        importedAt: Date.now()
      }
      await fs.writeFile(path.join(temp, META_FILE), JSON.stringify(sidecar, null, 2), 'utf8')
      await fs.rm(target, { recursive: true, force: true })
      await fs.rename(temp, target)
    } catch (error) {
      await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }

    const imported = await this.loadFromDir(target, id, source)
    this.skills.set(imported.meta.id, imported)
    return imported
  }

  private async loadFromDir(
    dir: string,
    knownId?: string,
    knownSource?: ImportSource
  ): Promise<ImportedSkill> {
    const markdown = await fs.readFile(path.join(dir, SKILL_FILE), 'utf8')
    const sidecar = readSidecar(
      await fs.readFile(path.join(dir, META_FILE), 'utf8').catch(() => null)
    )
    const document = parseSkillMarkdown(markdown, path.basename(dir))
    const files = await listDirectoryFiles(dir)
    const scripts = detectScripts(files)
    const id = knownId ?? sidecar.id ?? 'custom:' + path.basename(dir)
    const source = knownSource?.source ?? sidecar.source ?? 'local'
    const origin = knownSource?.origin ?? sidecar.origin ?? dir
    const importedAt = sidecar.importedAt ?? Date.now()
    return {
      meta: {
        id,
        name: document.name,
        icon: document.icon || '❖',
        description: document.description,
        risk: document.risk,
        settings: [],
        toolNames: [...CUSTOM_SKILL_TOOLS],
        kind: 'imported',
        origin,
        fileCount: files.length,
        scripts,
        version: document.version,
        importedAt
      },
      dir,
      body: document.body,
      files,
      scripts,
      source,
      origin
    }
  }
}

