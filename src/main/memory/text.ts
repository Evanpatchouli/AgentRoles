import { createHash } from 'node:crypto'
import type { MemoryRecord } from '@shared/types'

/**
 * 面向中文/英文混合文本的检索分词：
 * - 英文与数字按词切分
 * - 中文在保留整词的同时补充二元组，避免 unicode61 把整句当成一个 token
 */
export function tokenizeSearch(text: string): string[] {
  const normalized = text.toLowerCase()
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? []
  const output = new Set<string>()
  for (const word of words) {
    if (word.length < 2) continue
    output.add(word.slice(0, 80))
    if (/[\u3400-\u9fff]/.test(word) && word.length > 2) {
      for (let index = 0; index < word.length - 1; index += 1) {
        output.add(word.slice(index, index + 2))
      }
    }
    if (output.size >= 48) break
  }
  return [...output]
}

/** FTS5 索引文本：原文 + 二元组，让中文短查询也能命中。 */
export function buildSearchText(record: MemoryRecord): string {
  const base = [
    record.key,
    record.key,
    record.tags.join(' '),
    record.content
  ].join(' ')
  const tokens = tokenizeSearch(base)
  return (base.toLowerCase() + ' ' + tokens.join(' ')).slice(0, 24000)
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
