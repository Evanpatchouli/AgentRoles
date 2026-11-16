/**
 * 解析 SKILL.md：YAML frontmatter（只取技能需要的字段）+ 正文。
 * 不引入 YAML 依赖，支持常见的 key: value、引号和 | / > 多行写法。
 */

export interface SkillDocument {
  name: string
  description: string
  icon: string
  risk?: 'low' | 'medium' | 'high'
  version?: string
  /** frontmatter 之后的正文 */
  body: string
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if (first === '"' && last === '"') {
      return trimmed
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim()
    }
    if (first === "'" && last === "'") {
      return trimmed.slice(1, -1).replace(/''/g, "'").trim()
    }
  }
  return trimmed
}

function splitFrontmatter(raw: string): { header: string[]; body: string } | null {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  if (lines.length === 0 || lines[0].trim() !== '---') return null
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '---' || line === '...') {
      return {
        header: lines.slice(1, index),
        body: lines.slice(index + 1).join('\n').replace(/^\n+/, '')
      }
    }
  }
  return null
}

function readBlock(lines: string[], start: number, style: '|' | '>'): { value: string; next: number } {
  const collected: string[] = []
  let index = start
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() && !/^\s+/.test(line)) break
    collected.push(line)
    index += 1
  }
  while (collected.length > 0 && !collected[collected.length - 1].trim()) collected.pop()
  const indents = collected
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0)
  const indent = indents.length > 0 ? Math.min(...indents) : 0
  const dedented = collected.map((line) => line.slice(Math.min(indent, line.length)))
  const value =
    style === '|'
      ? dedented.join('\n').trim()
      : dedented
          .join('\n')
          .split(/\n\s*\n/)
          .map((paragraph) => paragraph.replace(/\n/g, ' ').trim())
          .filter(Boolean)
          .join('\n')
  return { value, next: index }
}

function parseHeader(header: string[]): Record<string, string> {
  const fields: Record<string, string> = {}
  for (let index = 0; index < header.length; index += 1) {
    const line = header[index]
    if (!line.trim() || /^\s*#/.test(line)) continue
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!match) continue
    const key = match[1].toLowerCase()
    const rest = match[2].trim()
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const block = readBlock(header, index + 1, rest.startsWith('|') ? '|' : '>')
      fields[key] = block.value
      index = block.next - 1
      continue
    }
    fields[key] = unquote(rest)
  }
  return fields
}

function fallbackDescription(body: string): string {
  const paragraph: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (paragraph.length > 0) break
      continue
    }
    if (trimmed.startsWith('#')) {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(trimmed)
  }
  const text = paragraph
    .join(' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[\x60*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 600 ? text.slice(0, 600) + '…' : text
}

export function parseSkillMarkdown(raw: string, fallbackName = '未命名技能'): SkillDocument {
  const split = splitFrontmatter(raw)
  if (!split) {
    return {
      name: fallbackName,
      description: fallbackDescription(raw),
      icon: '',
      body: raw.trim()
    }
  }
  const fields = parseHeader(split.header)
  const risk =
    fields.risk === 'high' || fields.risk === 'medium' || fields.risk === 'low'
      ? fields.risk
      : undefined
  return {
    name: fields.name || fallbackName,
    description: fields.description || fallbackDescription(split.body),
    icon: fields.icon || '',
    ...(risk ? { risk } : {}),
    ...(fields.version ? { version: fields.version } : {}),
    body: split.body.trim()
  }
}
