import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { IngressInfo, IngressRecord, IngressSettings } from '@shared/types'

export interface IngressPayload {
  content: string
  title?: string
  source?: string
  sender?: string
  session?: string
  metadata?: Record<string, unknown>
}

export interface IngestOutcome {
  messageId: string
  agentId: string
  agentName: string
  sessionId: string
  sessionTitle: string
  started: boolean
}

export interface IngressSessionInfo {
  id: string
  title: string
  updatedAt: number
}

export interface IngressHooks {
  version: string
  listAgents(): Array<{
    id: string
    name: string
    tagline: string
    avatar: string
    autoRun: boolean
    sessionCount?: number
  }>
  listSessions(agentKey: string): IngressSessionInfo[]
  ingest(agentKey: string, payload: IngressPayload): IngestOutcome
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function readBody(request: http.IncomingMessage, limit = 1_200_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new HttpError(413, '请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

export class IngressServer {
  private server: http.Server | null = null
  private token = ''
  private port = 0
  private error = ''
  private records: IngressRecord[] = []

  constructor(private readonly hooks: IngressHooks) {}

  getInfo(settings: IngressSettings): IngressInfo {
    return {
      running: Boolean(this.server),
      port: this.port || settings.port,
      token: this.token || settings.token,
      url: 'http://127.0.0.1:' + (this.port || settings.port),
      recent: [...this.records],
      ...(this.error ? { error: this.error } : {})
    }
  }

  private record(entry: IngressRecord): void {
    this.records.unshift(entry)
    if (this.records.length > 20) this.records = this.records.slice(0, 20)
  }

  private authorized(request: http.IncomingMessage): boolean {
    const header = request.headers.authorization ?? ''
    const bearer = header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : ''
    const alternate = String(request.headers['x-agentroles-token'] ?? '').trim()
    const provided = bearer || alternate
    return Boolean(provided) && safeEqual(provided, this.token)
  }

  async start(settings: IngressSettings): Promise<IngressInfo> {
    await this.stop()
    this.error = ''
    this.port = settings.port
    this.token = settings.token
    if (!settings.enabled) return this.getInfo(settings)

    const server = http.createServer((request, response) => {
      void this.handle(request, response)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(settings.port, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
    } catch (error: any) {
      this.server = null
      this.error =
        error?.code === 'EADDRINUSE'
          ? '端口 ' + settings.port + ' 已被占用，请更换端口'
          : '启动外部接入服务失败：' + (error?.message ?? String(error))
      console.error('[ingress]', this.error)
      return this.getInfo(settings)
    }

    server.on('error', (error) => {
      this.error = '外部接入服务错误：' + error.message
      console.error('[ingress]', error)
    })
    this.server = server
    console.log('[ingress] listening on http://127.0.0.1:' + settings.port)
    return this.getInfo(settings)
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      setTimeout(resolve, 1500).unref()
    })
  }

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    const send = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body)
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-AgentRoles-Token',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      })
      response.end(payload)
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-AgentRoles-Token',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      })
      response.end()
      return
    }

    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')

      if (request.method === 'GET' && url.pathname === '/health') {
        send(200, {
          ok: true,
          app: 'AgentRoles',
          version: this.hooks.version,
          agents: this.hooks.listAgents().length
        })
        return
      }

      if (!this.authorized(request)) {
        send(401, { ok: false, error: '未授权：请提供 Bearer Token（见应用设置 → 外部接入）' })
        return
      }

      if (request.method === 'GET' && url.pathname === '/v1/agents') {
        send(200, { ok: true, agents: this.hooks.listAgents() })
        return
      }

      const sessionMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)\/sessions$/)
      if (request.method === 'GET' && sessionMatch) {
        const key = decodeURIComponent(sessionMatch[1] ?? '')
        try {
          send(200, { ok: true, sessions: this.hooks.listSessions(key) })
        } catch (error) {
          throw new HttpError(404, error instanceof Error ? error.message : String(error))
        }
        return
      }

      let agentKey = ''
      if (request.method === 'POST' && url.pathname === '/v1/messages') {
        agentKey = ''
      } else if (request.method === 'POST' && /^\/v1\/agents\/[^/]+\/messages$/.test(url.pathname)) {
        agentKey = decodeURIComponent(url.pathname.split('/')[3] ?? '')
      } else {
        send(404, { ok: false, error: '未知接口：' + request.method + ' ' + url.pathname })
        return
      }

      const raw = await readBody(request)
      let body: any
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        throw new HttpError(400, '请求体必须是合法 JSON')
      }
      const content = typeof body.content === 'string' ? body.content.trim() : ''
      if (!content) throw new HttpError(400, 'content 不能为空')
      const key = agentKey || String(body.agent ?? body.agentId ?? '').trim()
      if (!key) throw new HttpError(400, '缺少 agent：请在路径中指定角色 id/名称，或在 body 传 agent 字段')

      const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'http'
      const metadata =
        body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : undefined
      let outcome: IngestOutcome
      try {
        outcome = this.hooks.ingest(key, {
          content,
          source,
          title: typeof body.title === 'string' ? body.title : undefined,
          sender: typeof body.sender === 'string' ? body.sender : undefined,
          session: typeof body.session === 'string' ? body.session : undefined,
          metadata
        })
      } catch (error) {
        throw new HttpError(404, error instanceof Error ? error.message : String(error))
      }

      this.record({
        at: Date.now(),
        source,
        agent: outcome.agentName,
        ok: true,
        summary: content.slice(0, 80)
      })
      send(202, { ok: true, ...outcome, queued: !outcome.started })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)
      this.record({
        at: Date.now(),
        source: 'http',
        agent: '',
        ok: false,
        summary: message.slice(0, 100)
      })
      send(status, { ok: false, error: message })
    }
  }
}
