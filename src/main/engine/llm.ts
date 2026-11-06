import type { ModelSettings } from '@shared/types'

export interface LlmTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LlmMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: Array<{ id: string; name: string; args: string }>
  toolCallId?: string
}

export interface LlmToolCall {
  id: string
  name: string
  args: string
}

export interface LlmResult {
  text: string
  reasoning: string
  toolCalls: LlmToolCall[]
  finishReason: string
}

export interface StreamHandlers {
  onText(delta: string): void
  onReasoning?(delta: string): void
}

const PROVIDER_LABEL: Record<string, string> = {
  openai: '模型服务',
  anthropic: 'Anthropic',
  responses: 'OpenAI Responses'
}

function buildUrl(model: ModelSettings, kind: 'chat' | 'messages' | 'responses'): string {
  const base = (model.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('未配置 Base URL')
  if (kind === 'chat') {
    if (base.endsWith('/chat/completions')) return base
    return base + '/chat/completions'
  }
  if (kind === 'messages') {
    if (base.endsWith('/messages')) return base
    return base.endsWith('/v1') ? base + '/messages' : base + '/v1/messages'
  }
  if (base.endsWith('/responses')) return base
  return base.endsWith('/v1') ? base + '/responses' : base + '/v1/responses'
}

async function assertOk(response: Response, provider: string): Promise<void> {
  if (response.ok) return
  const text = await response.text()
  let detail = text.slice(0, 600)
  try {
    const parsed = JSON.parse(text)
    detail = parsed?.error?.message || parsed?.message || detail
  } catch {
    /* keep raw text */
  }
  const hint =
    response.status === 401 || response.status === 403
      ? '（请检查 API Key 是否有权限）'
      : response.status === 404
        ? '（请检查 Base URL 与模型名称）'
        : ''
  throw new Error(
    (PROVIDER_LABEL[provider] ?? '模型服务') +
      ' 请求失败：HTTP ' +
      response.status +
      ' ' +
      detail +
      hint
  )
}

async function* readSse(
  response: Response
): AsyncGenerator<{ event?: string; data: string }> {
  if (!response.body) throw new Error('模型服务没有返回响应体')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event: string | undefined
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      let line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line === '') {
        event = undefined
      } else if (line.startsWith(':')) {
        // comment / heartbeat
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        yield { event, data: line.slice(5).trimStart() }
      }
      index = buffer.indexOf('\n')
    }
  }
  if (buffer.trim().startsWith('data:')) {
    yield { event, data: buffer.trim().slice(5).trimStart() }
  }
}

function parseJson(value: string): any | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function openAiChat(
  model: ModelSettings,
  system: string,
  messages: LlmMessage[],
  tools: LlmTool[],
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<LlmResult> {
  const url = buildUrl(model, 'chat')
  const apiMessages: unknown[] = [{ role: 'system', content: system }]
  for (const message of messages) {
    if (message.role === 'user') {
      apiMessages.push({ role: 'user', content: message.content })
    } else if (message.role === 'assistant') {
      const toolCalls = (message.toolCalls ?? []).map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.args }
      }))
      apiMessages.push({
        role: 'assistant',
        content: message.content || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {})
      })
    } else {
      apiMessages.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content
      })
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (model.apiKey.trim()) headers.Authorization = 'Bearer ' + model.apiKey.trim()

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: model.model,
        messages: apiMessages,
        stream: true,
        ...(typeof model.temperature === 'number' ? { temperature: model.temperature } : {}),
        ...(model.maxTokens ? { max_tokens: model.maxTokens } : {}),
        ...(tools.length
          ? {
              tools: tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters
                }
              })),
              tool_choice: 'auto'
            }
          : {})
      })
    })
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error
    throw new Error('无法连接模型服务 ' + url + '：' + (error?.message ?? String(error)))
  }

  await assertOk(response, model.provider)

  let text = ''
  let reasoning = ''
  let finishReason = ''
  const calls = new Map<number, { id: string; name: string; args: string }>()

  for await (const chunk of readSse(response)) {
    if (chunk.data === '[DONE]') break
    const json = parseJson(chunk.data)
    if (!json) continue
    const choice = json.choices?.[0]
    if (!choice) continue
    const delta = choice.delta ?? {}
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content
      handlers.onText(delta.content)
    }
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      reasoning += delta.reasoning_content
      handlers.onReasoning?.(delta.reasoning_content)
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const item of delta.tool_calls) {
        const index = typeof item.index === 'number' ? item.index : calls.size
        const entry = calls.get(index) ?? { id: '', name: '', args: '' }
        if (item.id) entry.id = item.id
        if (item.function?.name) entry.name = item.function.name
        if (item.function?.arguments) entry.args += item.function.arguments
        calls.set(index, entry)
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }

  return {
    text,
    reasoning,
    finishReason,
    toolCalls: [...calls.values()]
      .filter((call) => call.name)
      .map((call, index) => ({
        id: call.id || 'call_' + Date.now() + '_' + index,
        name: call.name,
        args: call.args || '{}'
      }))
  }
}

function anthropicBlocks(content: string): Array<Record<string, unknown>> {
  return content ? [{ type: 'text', text: content }] : []
}

function toAnthropicMessages(
  messages: LlmMessage[]
): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  const output: Array<{ role: 'user' | 'assistant'; content: any }> = []
  const push = (role: 'user' | 'assistant', blocks: any): void => {
    const last = output[output.length - 1]
    if (last && last.role === role) {
      const previous = Array.isArray(last.content)
        ? last.content
        : [{ type: 'text', text: String(last.content) }]
      const next = Array.isArray(blocks) ? blocks : [{ type: 'text', text: String(blocks) }]
      last.content = [...previous, ...next]
    } else {
      output.push({ role, content: blocks })
    }
  }

  for (const message of messages) {
    if (message.role === 'user') {
      push('user', anthropicBlocks(message.content))
    } else if (message.role === 'assistant') {
      const blocks: any[] = anthropicBlocks(message.content)
      for (const call of message.toolCalls ?? []) {
        let input: unknown = {}
        try {
          input = JSON.parse(call.args || '{}')
        } catch {
          input = {}
        }
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input })
      }
      if (blocks.length) push('assistant', blocks)
    } else {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content || '（无输出）'
        }
      ])
    }
  }
  return output
}

async function anthropicMessages(
  model: ModelSettings,
  system: string,
  messages: LlmMessage[],
  tools: LlmTool[],
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<LlmResult> {
  const url = buildUrl(model, 'messages')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01'
  }
  if (model.apiKey.trim()) headers['x-api-key'] = model.apiKey.trim()

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: model.model,
        max_tokens: model.maxTokens || 4096,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(messages),
        ...(typeof model.temperature === 'number'
          ? { temperature: Math.min(1, Math.max(0, model.temperature)) }
          : {}),
        ...(tools.length
          ? {
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters
              }))
            }
          : {}),
        stream: true
      })
    })
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error
    throw new Error('无法连接 Anthropic：' + (error?.message ?? String(error)))
  }

  await assertOk(response, 'anthropic')

  let text = ''
  let reasoning = ''
  let finishReason = ''
  const blocks = new Map<number, { type: string; id: string; name: string; args: string }>()

  for await (const chunk of readSse(response)) {
    const json = parseJson(chunk.data)
    if (!json) continue
    if (json.type === 'content_block_start') {
      const block = json.content_block ?? {}
      blocks.set(json.index, {
        type: block.type ?? 'text',
        id: block.id ?? '',
        name: block.name ?? '',
        args: ''
      })
    } else if (json.type === 'content_block_delta') {
      const entry = blocks.get(json.index)
      if (!entry) continue
      const delta = json.delta ?? {}
      if (delta.type === 'text_delta' && delta.text) {
        text += delta.text
        handlers.onText(delta.text)
      } else if (delta.type === 'input_json_delta' && delta.partial_json) {
        entry.args += delta.partial_json
      } else if (delta.type === 'thinking_delta' && delta.thinking) {
        reasoning += delta.thinking
        handlers.onReasoning?.(delta.thinking)
      }
    } else if (json.type === 'message_delta') {
      if (json.delta?.stop_reason) finishReason = json.delta.stop_reason
    } else if (json.type === 'error') {
      throw new Error('Anthropic 流式错误：' + (json.error?.message ?? '未知错误'))
    }
  }

  return {
    text,
    reasoning,
    finishReason,
    toolCalls: [...blocks.values()]
      .filter((block) => block.type === 'tool_use' && block.name)
      .map((block) => ({
        id: block.id,
        name: block.name,
        args: block.args || '{}'
      }))
  }
}

function toResponsesInput(messages: LlmMessage[]): any[] {
  const input: any[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      input.push({ role: 'user', content: message.content })
    } else if (message.role === 'assistant') {
      if (message.content) {
        input.push({ role: 'assistant', content: message.content })
      }
      for (const call of message.toolCalls ?? []) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.args
        })
      }
    } else {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content || '（无输出）'
      })
    }
  }
  return input
}

async function openAiResponses(
  model: ModelSettings,
  system: string,
  messages: LlmMessage[],
  tools: LlmTool[],
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<LlmResult> {
  const url = buildUrl(model, 'responses')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (model.apiKey.trim()) headers.Authorization = 'Bearer ' + model.apiKey.trim()

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: model.model,
        instructions: system,
        input: toResponsesInput(messages),
        stream: true,
        ...(model.maxTokens ? { max_output_tokens: model.maxTokens } : {}),
        ...(tools.length
          ? {
              tools: tools.map((tool) => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
              })),
              tool_choice: 'auto'
            }
          : {})
      })
    })
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error
    throw new Error('无法连接 OpenAI Responses：' + (error?.message ?? String(error)))
  }

  await assertOk(response, 'responses')

  let text = ''
  let finishReason = ''
  const calls = new Map<number, { id: string; name: string; args: string }>()

  for await (const chunk of readSse(response)) {
    const json = parseJson(chunk.data)
    if (!json) continue
    if (json.type === 'response.output_text.delta' && json.delta) {
      text += json.delta
      handlers.onText(json.delta)
    } else if (json.type === 'response.output_item.added') {
      const item = json.item ?? {}
      if (item.type === 'function_call') {
        calls.set(json.output_index ?? calls.size, {
          id: item.call_id || item.id || '',
          name: item.name ?? '',
          args: ''
        })
      }
    } else if (json.type === 'response.function_call_arguments.delta') {
      const entry = calls.get(json.output_index ?? 0)
      if (entry && typeof json.delta === 'string') entry.args += json.delta
    } else if (json.type === 'response.function_call_arguments.done') {
      const entry = calls.get(json.output_index ?? 0)
      if (entry && typeof json.arguments === 'string') entry.args = json.arguments
    } else if (json.type === 'response.output_item.done') {
      const item = json.item ?? {}
      if (item.type === 'function_call') {
        const entry = calls.get(json.output_index ?? calls.size - 1)
        if (entry) {
          if (item.call_id) entry.id = item.call_id
          if (item.name) entry.name = item.name
          if (typeof item.arguments === 'string' && item.arguments) entry.args = item.arguments
        }
      }
    } else if (json.type === 'response.completed') {
      finishReason = json.response?.status ?? 'completed'
    } else if (json.type === 'response.failed') {
      throw new Error(
        'OpenAI Responses 失败：' + (json.response?.error?.message ?? '未知错误')
      )
    } else if (json.type === 'error') {
      throw new Error('OpenAI Responses 错误：' + (json.message ?? json.error?.message ?? '未知错误'))
    }
  }

  return {
    text,
    reasoning: '',
    finishReason,
    toolCalls: [...calls.values()]
      .filter((call) => call.name)
      .map((call, index) => ({
        id: call.id || 'call_' + Date.now() + '_' + index,
        name: call.name,
        args: call.args || '{}'
      }))
  }
}

export async function streamChat(options: {
  model: ModelSettings
  system: string
  messages: LlmMessage[]
  tools: LlmTool[]
  handlers: StreamHandlers
  signal: AbortSignal
}): Promise<LlmResult> {
  const { model, system, messages, tools, handlers, signal } = options
  if (!model.model.trim()) throw new Error('未配置模型名称')
  switch (model.provider) {
    case 'anthropic':
      return anthropicMessages(model, system, messages, tools, handlers, signal)
    case 'responses':
      return openAiResponses(model, system, messages, tools, handlers, signal)
    case 'openai':
    default:
      return openAiChat(model, system, messages, tools, handlers, signal)
  }
}
