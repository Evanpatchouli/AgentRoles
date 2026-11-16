import { inflateRawSync } from 'node:zlib'

/**
 * 最小 ZIP 读取器：只支持应用需要的 store / deflate 两种压缩方式。
 * 不依赖第三方库，也不支持加密与 ZIP64。
 */

export interface ZipEntry {
  /** 归一化后的 POSIX 相对路径 */
  name: string
  data: Buffer
  isDirectory: boolean
}

export interface ZipLimits {
  maxEntries?: number
  maxEntryBytes?: number
  maxTotalBytes?: number
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

function fail(message: string): never {
  throw new Error('读取 ZIP 失败：' + message)
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const earliest = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  return fail('找不到中央目录，文件可能不是 ZIP 或已损坏')
}

function safeEntryName(raw: string): string {
  const normalized = raw.replace(/\\/g, '/').replace(/^\.?\/+/, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    fail('压缩包包含非法路径：' + JSON.stringify(raw))
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..')) {
    fail('压缩包包含越界路径：' + JSON.stringify(raw))
  }
  return segments.filter(Boolean).join('/')
}

export function readZipArchive(buffer: Buffer, limits: ZipLimits = {}): ZipEntry[] {
  const maxEntries = limits.maxEntries ?? 5000
  const maxEntryBytes = limits.maxEntryBytes ?? 16 * 1024 * 1024
  const maxTotalBytes = limits.maxTotalBytes ?? 96 * 1024 * 1024

  const eocd = findEndOfCentralDirectory(buffer)
  const totalEntries = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  let cursor = buffer.readUInt32LE(eocd + 16)

  if (totalEntries === 0xffff || centralSize === 0xffffffff || cursor === 0xffffffff) {
    fail('暂不支持 ZIP64 格式')
  }
  if (totalEntries > maxEntries) {
    fail('文件数量超过上限（' + totalEntries + ' > ' + maxEntries + '）')
  }

  const entries: ZipEntry[] = []
  let totalBytes = 0

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > buffer.length) fail('中央目录不完整')
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) fail('中央目录签名不匹配')

    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const rawName = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8')

    if (flags & 0x0001) fail('暂不支持加密的 ZIP 文件')
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      fail('暂不支持 ZIP64 格式')
    }

    const isDirectory = rawName.endsWith('/') || rawName.endsWith('\\')
    const name = safeEntryName(rawName)
    if (!isDirectory && uncompressedSize > maxEntryBytes) {
      fail('单个文件超过大小上限：' + name)
    }
    if (totalBytes + uncompressedSize > maxTotalBytes) {
      fail('解压后总大小超过上限')
    }

    if (!isDirectory) {
      if (localOffset + 30 > buffer.length) fail('本地文件头不完整：' + name)
      if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
        fail('本地文件头签名不匹配：' + name)
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const dataEnd = dataStart + compressedSize
      if (dataEnd > buffer.length) fail('文件数据不完整：' + name)
      const raw = buffer.subarray(dataStart, dataEnd)
      let data: Buffer
      if (method === 0) {
        data = Buffer.from(raw)
      } else if (method === 8) {
        data = inflateRawSync(raw)
      } else {
        fail('不支持的压缩方式 ' + method + '：' + name)
      }
      if (data.length !== uncompressedSize) {
        fail('解压后大小不一致：' + name)
      }
      totalBytes += data.length
      entries.push({ name, data, isDirectory: false })
    } else {
      entries.push({ name, data: Buffer.alloc(0), isDirectory: true })
    }

    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}
