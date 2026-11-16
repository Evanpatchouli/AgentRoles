import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Agent, AppSettings } from '@shared/types'
import { CustomSkillLibrary, customSkillPrompt, customSkillTools } from '../src/main/skills/custom'
import type { ToolContext } from '../src/main/skills/types'
import { parseSkillMarkdown } from '../src/main/skills/frontmatter'
import { buildToolsForAgent } from '../src/main/skills'
import { buildSystemPrompt } from '../src/main/engine/prompt'
import { readZipArchive } from '../src/main/skills/zip'

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeZip(entries: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.content, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const localBlock = Buffer.concat([local, name, data])

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, name]))
    locals.push(localBlock)
    offset += localBlock.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, directory, end])
}

function skillMarkdown(name: string, body: string): string {
  return [
    '---',
    'name: ' + name,
    'description: |',
    '  第一行说明',
    '  第二行说明',
    'version: 1.2.0',
    '---',
    '',
    body
  ].join('\n')
}

function fakeContext(agent: Agent): ToolContext {
  return {
    agent,
    settings: { workspaceDir: os.tmpdir() },
    dataDir: os.tmpdir(),
    workspaceDir: os.tmpdir(),
    signal: new AbortController().signal,
    memory: {} as never
  } as unknown as ToolContext
}

async function main(): Promise<void> {
  const parsed = parseSkillMarkdown(skillMarkdown('demo-skill', '# Demo\n\n正文内容'))
  assert.equal(parsed.name, 'demo-skill')
  assert.equal(parsed.description, '第一行说明\n第二行说明')
  assert.equal(parsed.version, '1.2.0')
  assert.equal(parsed.body, '# Demo\n\n正文内容')

  const fallback = parseSkillMarkdown('# 只有正文\n\n这是第一段说明。', 'fallback-name')
  assert.equal(fallback.name, 'fallback-name')
  assert.equal(fallback.description, '这是第一段说明。')

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentroles-skills-'))
  const fixture = path.join(root, 'fixture')
  await fs.mkdir(path.join(fixture, 'references'), { recursive: true })
  await fs.mkdir(path.join(fixture, 'scripts'), { recursive: true })
  await fs.mkdir(path.join(fixture, 'node_modules'), { recursive: true })
  await fs.writeFile(
    path.join(fixture, 'SKILL.md'),
    skillMarkdown('demo-skill', '# Demo\n\n先读 references/note.md，再运行 scripts/run.py。'),
    'utf8'
  )
  await fs.writeFile(path.join(fixture, 'references', 'note.md'), '参考内容：保持最小改动。', 'utf8')
  await fs.writeFile(path.join(fixture, 'scripts', 'run.py'), 'print("ok")\n', 'utf8')
  await fs.writeFile(path.join(fixture, 'node_modules', 'ignored.js'), 'ignored', 'utf8')

  const library = new CustomSkillLibrary(path.join(root, 'skills'))
  await library.load()
  const imported = await library.importFolder(fixture)
  assert.equal(imported.meta.id, 'custom:demo-skill')
  assert.equal(imported.meta.kind, 'imported')
  assert.equal(imported.meta.fileCount, 3)
  assert.deepEqual(imported.scripts, ['scripts/run.py'])
  assert.ok(!imported.files.some((name) => name.startsWith('node_modules/')))
  assert.ok(customSkillPrompt(imported).includes('参考内容') === false)
  assert.ok(customSkillPrompt(imported).includes('skill_read'))
  assert.ok(customSkillPrompt(imported).includes('终端命令'))

  const agent = { id: 'agent-1', skills: { [imported.meta.id]: { enabled: true, settings: {} } } } as unknown as Agent
  const tools = customSkillTools(library)
  const listTool = tools.find((tool) => tool.name === 'skill_list')
  const readTool = tools.find((tool) => tool.name === 'skill_read')
  assert.ok(listTool)
  assert.ok(readTool)

  const listed = JSON.parse(await listTool.execute({ skill: imported.meta.id }, fakeContext(agent)))
  assert.ok(listed.entries.some((entry: { name: string }) => entry.name === 'references'))

  const read = JSON.parse(
    await readTool.execute(
      { skill: imported.meta.id, path: 'references/note.md' },
      fakeContext(agent)
    )
  )
  assert.equal(read.content, '参考内容：保持最小改动。')

  await assert.rejects(
    readTool.execute({ skill: imported.meta.id, path: '../SKILL.md' }, fakeContext(agent)),
    /路径越界/
  )

  const fullAgent = {
    ...agent,
    name: '测试角色',
    tagline: '测试技能注入',
    role: '你是一名测试助手。'
  } as Agent
  const settings = { workspaceDir: os.tmpdir() } as unknown as AppSettings
  const built = buildToolsForAgent({
    agent: fullAgent,
    settings,
    dataDir: root,
    signal: new AbortController().signal,
    memory: {} as never,
    customSkills: library
  })
  assert.ok(built.tools.some((tool) => tool.name === 'skill_list'))
  assert.ok(built.tools.some((tool) => tool.name === 'skill_read'))
  const systemPrompt = buildSystemPrompt(fullAgent, settings, '', library)
  assert.ok(systemPrompt.includes('先读 references/note.md'))
  assert.ok(systemPrompt.includes('技能目录：' + imported.dir))
  assert.ok(systemPrompt.includes('skill_read'))

  const disabled = { id: 'agent-2', skills: {} } as unknown as Agent
  await assert.rejects(
    readTool.execute({ skill: imported.meta.id, path: 'SKILL.md' }, fakeContext(disabled)),
    /没有在当前角色启用/
  )
  const disabledTools = buildToolsForAgent({
    agent: disabled,
    settings,
    dataDir: root,
    signal: new AbortController().signal,
    memory: {} as never,
    customSkills: library
  })
  assert.ok(!disabledTools.tools.some((tool) => tool.name === 'skill_read'))

  const zip = makeZip([
    { name: 'repo-main/skills/zip-skill/SKILL.md', content: skillMarkdown('zip-skill', '# Zip') },
    { name: 'repo-main/skills/zip-skill/references/readme.md', content: 'zip reference' },
    { name: 'repo-main/skills/zip-skill/assets/logo.bin', content: 'binary' }
  ])
  const entries = readZipArchive(zip)
  assert.equal(entries.length, 3)
  assert.equal(entries[0].name, 'repo-main/skills/zip-skill/SKILL.md')

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/zip' })
    response.end(zip)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    const fromUrl = await library.importUrl(
      'http://127.0.0.1:' + address.port + '/skill.zip'
    )
    assert.equal(fromUrl.meta.id, 'custom:zip-skill')
    assert.equal(fromUrl.source, 'url')
    assert.ok(fromUrl.files.includes('references/readme.md'))
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  const reloaded = new CustomSkillLibrary(path.join(root, 'skills'))
  await reloaded.load()
  assert.deepEqual(
    reloaded.metas().map((meta) => meta.id).sort(),
    ['custom:demo-skill', 'custom:zip-skill']
  )

  assert.equal(await library.remove(imported.meta.id), true)
  assert.equal(library.get(imported.meta.id), undefined)
  assert.equal(await fs.stat(imported.dir).then(() => true, () => false), false)

  await fs.rm(root, { recursive: true, force: true })
  console.log('[skills] SKILL.md、ZIP、导入、读取与删除 OK')
  console.log('[skills] PASS ' + randomUUID().slice(0, 8))
}

void main().catch((error) => {
  console.error('[skills] FAIL', error)
  process.exit(1)
})
