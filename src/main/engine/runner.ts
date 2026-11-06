import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  AgentRuntimeState,
  ChatMessage,
  MessageState,
  SendResult,
  Session,
  StartRunResult,
  ToolCall
} from '@shared/types'
import type { Store } from '../store'
import { buildToolsForAgent } from '../skills'
import { truncate } from '../skills/types'
import { buildSystemPrompt, userContentForLlm } from './prompt'
import { streamChat, type LlmMessage } from './llm'

const MAX_STEPS = 10
const HISTORY_LIMIT = 40
const TOOL_RESULT_LIMIT = 12000

interface Runtime {
  running: boolean
  abort: AbortController | null
  queue: string[]
  stopped: boolean
  task: Promise<void> | null
}

interface IngestOptions {
  source?: string
  title?: string
  sender?: string
  externalId?: string
  metadata?: Record<string, unknown>
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError')
  )
}

function buildHistory(messages: ChatMessage[], triggerId: string): LlmMessage[] {
  const filtered = messages.filter((message) => {
    if (message.role === 'user') {
      return message.state !== 'pending' || message.id === triggerId
    }
    return message.state === 'done' && Boolean(message.content || message.toolCalls?.length)
  })
  let start = Math.max(0, filtered.length - HISTORY_LIMIT)
  while (start < filtered.length && filtered[start].role !== 'user') start += 1

  const approximateSize = (from: number): number => {
    let size = 0
    for (let index = from; index < filtered.length; index += 1) {
      const message = filtered[index]
      size += message.content.length
      for (const call of message.toolCalls ?? []) {
        size += String(call.result ?? '').length + 200
      }
    }
    return size
  }

  while (start < filtered.length - 1 && approximateSize(start) > 120000) {
    let next = start + 1
    while (next < filtered.length && filtered[next].role !== 'user') next += 1
    if (next >= filtered.length) break
    start = next
  }

  const window = filtered.slice(start)
  const output: LlmMessage[] = []
  for (const message of window) {
    if (message.role === 'user') {
      output.push({ role: 'user', content: userContentForLlm(message) })
      continue
    }
    const completed = (message.toolCalls ?? []).filter((call) => call.result !== undefined)
    if (!message.content && completed.length === 0) continue
    output.push({
      role: 'assistant',
      content: message.content,
      toolCalls: completed.map((call) => ({
        id: call.id,
        name: call.name,
        args: JSON.stringify(call.args ?? {})
      }))
    })
    for (const call of completed) {
      output.push({
        role: 'tool',
        toolCallId: call.id,
        content: truncate(String(call.result ?? ''), 8000)
      })
    }
  }
  return output
}

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export class AgentManager {
  private runtimes = new Map<string, Runtime>()

  constructor(
    private readonly store: Store,
    private readonly emit: (event: AgentEvent) => void
  ) {}

  private runtime(sessionId: string): Runtime {
    let runtime = this.runtimes.get(sessionId)
    if (!runtime) {
      runtime = { running: false, abort: null, queue: [], stopped: false, task: null }
      this.runtimes.set(sessionId, runtime)
    }
    return runtime
  }

  getRuntimeStates(): Record<string, AgentRuntimeState> {
    const states: Record<string, AgentRuntimeState> = {}
    for (const session of this.store.getAllSessions()) {
      const runtime = this.runtime(session.id)
      states[session.id] = { running: runtime.running, queued: runtime.queue.length }
    }
    return states
  }

  isRunning(sessionId: string): boolean {
    return this.runtime(sessionId).running
  }

  private emitState(sessionId: string): void {
    const session = this.store.getSession(sessionId)
    if (!session) return
    const runtime = this.runtime(sessionId)
    this.emit({
      type: 'agent_state',
      agentId: session.agentId,
      sessionId,
      running: runtime.running,
      queued: runtime.queue.length
    })
  }

  private emitSessionUpdated(sessionId: string): void {
    const session = this.store.getSession(sessionId)
    if (!session) return
    this.emit({
      type: 'session_updated',
      agentId: session.agentId,
      session
    })
  }

  private setMessageState(
    sessionId: string,
    messageId: string,
    state: MessageState
  ): ChatMessage | undefined {
    const message = this.store.patchMessage(sessionId, messageId, { state })
    if (message) {
      this.emit({
        type: 'message_updated',
        agentId: message.agentId,
        sessionId,
        message: clone(message)
      })
    }
    return message
  }

  private createUserMessage(
    session: Session,
    content: string,
    source: string,
    options: IngestOptions = {}
  ): ChatMessage {
    const text = content.trim()
    if (!text) throw new Error('消息内容不能为空')
    if (text.length > 40000) throw new Error('消息过长（上限 40000 字符）')
    return {
      id: randomUUID(),
      agentId: session.agentId,
      sessionId: session.id,
      role: 'user',
      content: text,
      state: 'pending',
      source,
      meta: {
        ...(options.metadata ?? {}),
        ...(options.title ? { title: options.title } : {}),
        ...(options.sender ? { sender: options.sender } : {}),
        ...(options.externalId ? { externalId: options.externalId } : {})
      },
      createdAt: Date.now()
    }
  }

  async sendFromApp(sessionId: string, content: string): Promise<SendResult> {
    const session = this.store.getSession(sessionId)
    if (!session) return { ok: false, error: '会话不存在' }
    const agent = this.store.getAgent(session.agentId)
    if (!agent) return { ok: false, error: '角色不存在' }
    if (this.isRunning(sessionId)) {
      return { ok: false, error: '当前会话正在处理中，请等本轮完成' }
    }
    let message: ChatMessage
    try {
      message = this.createUserMessage(session, content, 'app')
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    this.store.appendMessage(message)
    this.emit({
      type: 'message_added',
      agentId: session.agentId,
      sessionId,
      message: clone(message)
    })
    this.emitSessionUpdated(sessionId)
    this.startRun(sessionId, message.id)
    return { ok: true, message: clone(message) }
  }

  ingest(
    agentId: string,
    sessionKey: string | undefined,
    content: string,
    options: IngestOptions = {}
  ): { message: ChatMessage; started: boolean; session: Session } {
    const agent = this.store.getAgent(agentId)
    if (!agent) throw new Error('角色不存在：' + agentId)
    const session = sessionKey
      ? this.store.findSession(agentId, sessionKey)
      : this.store.getDefaultSession(agentId)
    if (!session) {
      throw new Error('会话不存在：' + (sessionKey || '默认会话'))
    }
    const message = this.createUserMessage(
      session,
      content,
      options.source || 'http',
      options
    )
    this.store.appendMessage(message)
    this.emit({
      type: 'message_added',
      agentId: session.agentId,
      sessionId: session.id,
      message: clone(message)
    })
    this.emitSessionUpdated(session.id)

    let started = false
    if (agent.autoRun) {
      const runtime = this.runtime(session.id)
      if (runtime.running) {
        runtime.queue.push(message.id)
        this.emitState(session.id)
      } else {
        this.startRun(session.id, message.id)
        started = true
      }
    }
    return { message: clone(message), started, session }
  }

  async processMessage(sessionId: string, messageId: string): Promise<StartRunResult> {
    const messages = this.store.getMessages(sessionId)
    const message = messages.find((item) => item.id === messageId)
    if (!message || message.role !== 'user') return { ok: false, error: '消息不存在' }
    if (message.state === 'done') return { ok: false, error: '这条消息已经处理过了' }
    if (this.isRunning(sessionId)) {
      const runtime = this.runtime(sessionId)
      if (!runtime.queue.includes(messageId)) {
        runtime.queue.push(messageId)
        this.emitState(sessionId)
      }
      return { ok: true }
    }
    this.startRun(sessionId, messageId)
    return { ok: true }
  }

  private startRun(sessionId: string, triggerId: string): void {
    const runtime = this.runtime(sessionId)
    if (runtime.running) {
      if (!runtime.queue.includes(triggerId)) runtime.queue.push(triggerId)
      this.emitState(sessionId)
      return
    }
    runtime.running = true
    runtime.stopped = false
    runtime.abort = new AbortController()
    this.emitState(sessionId)
    const task = this.run(sessionId, triggerId, runtime.abort.signal)
    runtime.task = task
    void task
      .catch((error) => {
        console.error('[engine] 运行失败', error)
      })
      .finally(() => {
        runtime.running = false
        runtime.abort = null
        runtime.task = null
        this.emitState(sessionId)
        this.emitSessionUpdated(sessionId)
        const next = runtime.stopped ? undefined : runtime.queue.shift()
        runtime.stopped = false
        if (next) {
          const message = this.store.getMessages(sessionId).find((item) => item.id === next)
          if (message && message.state !== 'done') this.startRun(sessionId, next)
        }
      })
  }

  private async run(sessionId: string, triggerId: string, signal: AbortSignal): Promise<void> {
    const runId = randomUUID()
    const session = this.store.getSession(sessionId)
    if (!session) return
    const agent = this.store.getAgent(session.agentId)
    const settings = this.store.getSettings()
    if (!agent) return
    const trigger = this.store.getMessages(sessionId).find((item) => item.id === triggerId)
    if (!trigger) return

    this.emit({ type: 'run_start', agentId: session.agentId, sessionId, runId })
    this.setMessageState(sessionId, triggerId, 'running')
    const { tools, context } = buildToolsForAgent(
      agent,
      settings,
      this.store.dataDir,
      signal
    )
    let current: ChatMessage | null = null
    let finished = false

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const history = buildHistory(this.store.getMessages(sessionId), triggerId)
        const assistant: ChatMessage = {
          id: randomUUID(),
          agentId: session.agentId,
          sessionId,
          role: 'assistant',
          content: '',
          reasoning: '',
          state: 'running',
          runId,
          createdAt: Date.now()
        }
        current = assistant
        this.store.appendMessage(assistant)
        this.emit({
          type: 'message_added',
          agentId: session.agentId,
          sessionId,
          message: clone(assistant)
        })

        const result = await streamChat({
          model: agent.model,
          system: buildSystemPrompt(agent, settings),
          messages: history,
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          })),
          signal,
          handlers: {
            onText: (delta) => {
              assistant.content += delta
              this.emit({
                type: 'message_delta',
                agentId: session.agentId,
                sessionId,
                messageId: assistant.id,
                text: delta
              })
            },
            onReasoning: (delta) => {
              assistant.reasoning = (assistant.reasoning ?? '') + delta
              this.emit({
                type: 'message_delta',
                agentId: session.agentId,
                sessionId,
                messageId: assistant.id,
                text: '',
                reasoning: delta
              })
            }
          }
        })

        assistant.content = result.text
        if (result.reasoning) assistant.reasoning = result.reasoning

        const calls: ToolCall[] = result.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          args: parseArgs(call.args) ?? {},
          startedAt: Date.now()
        }))
        assistant.toolCalls = calls

        if (calls.length === 0) {
          assistant.state = 'done'
          this.store.updateMessage(sessionId, assistant)
          this.emit({
            type: 'message_updated',
            agentId: session.agentId,
            sessionId,
            message: clone(assistant)
          })
          finished = true
          break
        }

        for (const call of calls) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          const rawArgs = result.toolCalls.find((item) => item.id === call.id)?.args ?? ''
          const parsed = parseArgs(rawArgs)
          call.startedAt = Date.now()
          this.emit({
            type: 'tool_started',
            agentId: session.agentId,
            sessionId,
            messageId: assistant.id,
            call: clone(call)
          })

          let output = ''
          let ok = true
          if (parsed === null) {
            ok = false
            output = '工具参数不是合法的 JSON 对象：' + truncate(rawArgs, 300)
          } else {
            const tool = tools.find((item) => item.name === call.name)
            if (!tool) {
              ok = false
              output = '未找到工具：' + call.name
            } else {
              call.startedAt = Date.now()
              try {
                output = await tool.execute(parsed, context)
                if (typeof output !== 'string') output = JSON.stringify(output)
              } catch (error) {
                ok = false
                output = '工具执行失败：' + (error instanceof Error ? error.message : String(error))
              }
            }
          }
          call.args = parsed ?? {}
          call.result = truncate(String(output ?? ''), TOOL_RESULT_LIMIT)
          call.ok = ok
          call.endedAt = Date.now()
          this.emit({
            type: 'tool_finished',
            agentId: session.agentId,
            sessionId,
            messageId: assistant.id,
            callId: call.id,
            result: call.result,
            ok,
            endedAt: call.endedAt
          })
        }

        assistant.state = 'done'
        this.store.updateMessage(sessionId, assistant)
        this.emit({
          type: 'message_updated',
          agentId: session.agentId,
          sessionId,
          message: clone(assistant)
        })
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      }

      if (!finished) {
        throw new Error('达到单轮工具调用上限（' + MAX_STEPS + ' 次）')
      }

      this.setMessageState(sessionId, triggerId, 'done')
      this.emit({ type: 'run_end', agentId: session.agentId, sessionId, runId })
    } catch (error) {
      const aborted = signal.aborted || isAbort(error)
      const messageText = aborted
        ? '已停止。'
        : error instanceof Error
          ? error.message
          : String(error)
      if (current) {
        current.state = 'error'
        current.content =
          (current.content ? current.content + '\n\n' : '') +
          (aborted ? '⏹ 已停止。' : '⚠️ ' + messageText)
        this.store.updateMessage(sessionId, current)
        this.emit({
          type: 'message_updated',
          agentId: session.agentId,
          sessionId,
          message: clone(current)
        })
      }
      this.setMessageState(sessionId, triggerId, aborted ? 'pending' : 'error')
      this.emit({
        type: 'run_end',
        agentId: session.agentId,
        sessionId,
        runId,
        error: messageText
      })
    } finally {
      void this.store.persistMessages(sessionId)
    }
  }

  async stop(sessionId: string): Promise<{ ok: boolean }> {
    const runtime = this.runtime(sessionId)
    if (!runtime.running) return { ok: false }
    runtime.stopped = true
    runtime.queue = []
    runtime.abort?.abort()
    this.emitState(sessionId)
    if (runtime.task) await runtime.task.catch(() => undefined)
    return { ok: true }
  }

  async stopAgent(agentId: string): Promise<void> {
    for (const session of this.store.getSessions(agentId)) {
      await this.stop(session.id)
    }
  }

  forgetSession(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId)
    runtime?.abort?.abort()
    this.runtimes.delete(sessionId)
  }

  forgetAgent(agentId: string): void {
    for (const session of this.store.getSessions(agentId)) {
      this.forgetSession(session.id)
    }
  }

  shutdown(): void {
    for (const runtime of this.runtimes.values()) {
      runtime.stopped = true
      runtime.abort?.abort()
    }
  }
}
