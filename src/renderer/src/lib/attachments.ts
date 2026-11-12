import type { ChatAttachment } from '@shared/types'

export const MAX_ATTACHMENTS = 6
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024
const MAX_TEXT_CHARS = 200_000
const MAX_IMAGE_EDGE = 1600

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'csv', 'tsv', 'log', 'xml', 'yaml', 'yml',
  'toml', 'ini', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less',
  'html', 'htm', 'sql', 'py', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs',
  'rb', 'php', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'vue', 'svelte', 'astro'
])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'])

function extensionOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
}

function mimeOf(file: File): string {
  if (file.type) return file.type
  const ext = extensionOf(file.name)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image/' + (ext === 'jpg' ? 'jpeg' : ext)
  if (ext === 'pdf') return 'application/pdf'
  if (TEXT_EXTENSIONS.has(ext)) return 'text/plain'
  return 'application/octet-stream'
}

export function isTextFile(file: File): boolean {
  const mime = mimeOf(file)
  if (mime.startsWith('text/')) return true
  if (/^(application\/(json|xml|javascript|x-yaml|yaml))$/.test(mime)) return true
  return TEXT_EXTENSIONS.has(extensionOf(file.name))
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取文件'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error('无法解析图片'))
    image.onload = () => resolve(image)
    image.src = src
  })
}

async function compressImage(file: File): Promise<string> {
  const dataUrl = await readDataUrl(file)
  const image = await loadImage(dataUrl)
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return dataUrl
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/webp', 0.86)
}

export async function createAttachment(file: File): Promise<ChatAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(file.name + ' 超过 8MB，无法添加')
  }
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(16).slice(2)
  const name = file.name || '粘贴图片.png'
  const mime = mimeOf(file)
  const image = mime.startsWith('image/') || IMAGE_EXTENSIONS.has(extensionOf(name))

  if (image) {
    return {
      id,
      kind: 'image',
      name,
      mime: 'image/webp',
      size: file.size,
      dataUrl: await compressImage(file)
    }
  }

  if (isTextFile(file)) {
    const raw = await file.text()
    const truncated = raw.length > MAX_TEXT_CHARS
    return {
      id,
      kind: 'file',
      name,
      mime,
      size: file.size,
      text: truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw,
      ...(truncated ? { truncated: true } : {})
    }
  }

  return {
    id,
    kind: 'file',
    name,
    mime,
    size: file.size,
    dataUrl: await readDataUrl(file)
  }
}
