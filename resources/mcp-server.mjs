#!/usr/bin/env node
/**
 * AgentRoles MCP Server (stdio)
 *
 * 把任意支持 MCP 的客户端（Codex / Claude Code / DSH 等）接到运行中的 AgentRoles。
 * 用 node 运行；参数或环境变量提供本地接入地址与 Token。
 *
 *   node mcp-server.mjs --url http://127.0.0.1:43110 --token <token>
 *   AGENTROLES_URL=... AGENTROLES_TOKEN=... node mcp-server.mjs
 */
import process from 'node:process'

const VERSION = '0.1.1'

function parseArgs(argv) {
  const args = { url: '', token: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--url' && argv[index + 1]) args.url = argv[++index]
    else if (item === '--token' && argv[index + 1]) args.token = argv[++index]
    else if (item === '--help' || item === '-h') args.help = true
  }
  return args
}

const cli = parseArgs(process.argv.slice(2))
if (cli.help) {
  process.stderr.write(
    'AgentRoles MCP server\n\nUsage: node mcp-server.mjs --url <http://127.0.0.1:43110> --token <token>\n' +
      'Env: AGENTROLES_URL, AGENTROLES_TOKEN\n'
  )
  process.exit(0)
}

const BASE_URL = (cli.url || process.env.AGENTROLES_URL || 'http://127.0.0.1:43110').replace(/\/+$/, '')
const TOKEN = cli.token || process.env.AGENTROLES_TOKEN || ''

if (!TOKEN) {
  process.stderr.write('[agentroles-mcp] 缺少 token。请传 --token 或设置 AGENTROLES_TOKEN。\n')
  process.exit(1)
}

async function callApi(path, options = {}) {
  const response = await fetch(BASE_URL + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  if (!response.ok) {
    const message = data?.error || 'HTTP ' + response.status
    throw new Error(message)
  }
  return data
}

const TOOLS = [
  {
    name: 'agentroles_list_agents',
    description:
      '列出 AgentRoles 中可用的角色（id、名称、一句话职责、是否自动处理消息）。发消息前不确定角色名时先调用。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'agentroles_list_sessions',
    description:
      '列出指定角色下的历史会话（id、标题、更新时间）。把消息投递到某个历史会话前先调用，或直接用会话标题。',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: '角色名称或角色 id' }
      },
      required: ['agent']
    }
  },
  {
    name: 'agentroles_send_message',
    description:
      '把一条消息投递给 AgentRoles 里的指定角色。可用于提交需求、同步任务进展、委派工作。返回是否已接收以及消息 id。',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: '角色名称或角色 id，例如「需求记录员」'
        },
        content: {
          type: 'string',
          description: '消息正文。写清背景、目标与验收标准，便于记录员落成任务。'
        },
        title: {
          type: 'string',
          description: '可选标题，例如「登录页改版」'
        },
        source: {
          type: 'string',
          description: '来源标识，例如 codex / claude-code / dsh；默认 mcp'
        },
        sender: {
          type: 'string',
          description: '可选发送者名称，例如当前项目或 agent 名称'
        },
        session: {
          type: 'string',
          description: '可选会话 id 或会话标题；不传则进入角色的默认会话'
        }
      },
      required: ['agent', 'content']
    }
  }
]

async function handleToolCall(name, args) {
  if (name === 'agentroles_list_agents') {
    const data = await callApi('/v1/agents')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
  if (name === 'agentroles_list_sessions') {
    const agent = String(args?.agent || '').trim()
    if (!agent) throw new Error('agent 不能为空')
    const data = await callApi('/v1/agents/' + encodeURIComponent(agent) + '/sessions')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
  if (name === 'agentroles_send_message') {
    const agent = String(args?.agent || '').trim()
    const content = String(args?.content || '').trim()
    if (!agent) throw new Error('agent 不能为空')
    if (!content) throw new Error('content 不能为空')
    const data = await callApi('/v1/agents/' + encodeURIComponent(agent) + '/messages', {
      method: 'POST',
      body: JSON.stringify({
        content,
        title: args?.title ? String(args.title) : undefined,
        source: args?.source ? String(args.source) : 'mcp',
        sender: args?.sender ? String(args.sender) : undefined,
        session: args?.session ? String(args.session) : undefined
      })
    })
    return {
      content: [
        {
          type: 'text',
          text:
            '已接收：' +
            agent +
            (data.sessionTitle ? '（会话「' + data.sessionTitle + '」）' : '') +
            '，消息 ' +
            (data.messageId || 'unknown') +
            (data.started ? '，已开始处理' : '，已进入待处理队列')
        }
      ]
    }
  }
  throw new Error('未知工具：' + name)
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

async function handleMessage(message) {
  const { id, method, params } = message
  if (id === undefined || id === null) {
    return
  }
  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agentroles', version: VERSION }
        }
      })
      return
    }
    if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} })
      return
    }
    if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
      return
    }
    if (method === 'tools/call') {
      const result = await handleToolCall(params?.name, params?.arguments || {})
      send({ jsonrpc: '2.0', id, result })
      return
    }
    if (method === 'resources/list') {
      send({ jsonrpc: '2.0', id, result: { resources: [] } })
      return
    }
    if (method === 'prompts/list') {
      send({ jsonrpc: '2.0', id, result: { prompts: [] } })
      return
    }
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found: ' + method }
    })
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: '调用失败：' + (error?.message ?? String(error)) }],
        isError: true
      }
    })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) {
      try {
        void handleMessage(JSON.parse(line))
      } catch (error) {
        process.stderr.write('[agentroles-mcp] 无法解析消息：' + String(error) + '\n')
      }
    }
    index = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
process.stderr.write('[agentroles-mcp] ready at ' + BASE_URL + '\n')
