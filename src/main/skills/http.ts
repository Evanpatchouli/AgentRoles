import type { SkillDefinition } from './types'
import { json, strArg, truncate, withTimeout } from './types'

const MAX_BODY = 25000

export const httpSkill: SkillDefinition = {
  id: 'http',
  name: '网络请求',
  icon: '⇄',
  description: '发起 HTTP 请求，读取网页、调用内部 API 或 Webhook。',
  hint: '优先使用 GET 读取公开信息；POST/PUT/DELETE 等写操作要确认目标和参数。',
  risk: 'medium',
  settings: [],
  tools: [
    {
      name: 'http_request',
      description: '发起一次 HTTP 请求，返回状态码、响应头和响应正文（正文会截断）。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整 URL，必须包含 http:// 或 https://' },
          method: {
            type: 'string',
            description: 'HTTP 方法，默认 GET',
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
          },
          headers: {
            type: 'object',
            description: '请求头键值对',
            additionalProperties: { type: 'string' }
          },
          body: { type: 'string', description: '请求正文（字符串）' }
        },
        required: ['url']
      },
      async execute(args, ctx) {
        const rawUrl = strArg(args, 'url').trim()
        let url: URL
        try {
          url = new URL(rawUrl)
        } catch {
          throw new Error('URL 不合法：' + rawUrl)
        }
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new Error('只支持 http/https 协议')
        }
        const method = (strArg(args, 'method', 'GET') || 'GET').toUpperCase()
        const headers: Record<string, string> = {}
        if (args.headers && typeof args.headers === 'object') {
          for (const [key, value] of Object.entries(args.headers as Record<string, unknown>)) {
            headers[key] = String(value)
          }
        }
        const controller = new AbortController()
        const signal = withTimeout(ctx.signal, 25000)
        signal.addEventListener('abort', () => controller.abort(), { once: true })
        try {
          const response = await fetch(url, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : strArg(args, 'body'),
            signal: controller.signal,
            redirect: 'follow'
          })
          const text = await response.text()
          const responseHeaders: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value
          })
          return json({
            status: response.status,
            ok: response.ok,
            url: response.url,
            headers: responseHeaders,
            body: truncate(text, MAX_BODY)
          })
        } finally {
          controller.abort()
        }
      }
    }
  ]
}
