#!/usr/bin/env node
/**
 * AgentRoles CLI
 *
 *   node agentroles-cli.mjs agents
 *   node agentroles-cli.mjs send --agent "需求记录员" --content "..." [--title "..."] [--source codex]
 *   echo "..." | node agentroles-cli.mjs send --agent "需求记录员"
 *
 * 地址与 Token 也可以通过 AGENTROLES_URL / AGENTROLES_TOKEN 提供。
 */
import process from 'node:process'

const VERSION = '0.1.1'

function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item.startsWith('--')) {
      const key = item.slice(2)
      const next = argv[index + 1]
      if (next && !next.startsWith('--')) {
        args[key] = next
        index += 1
      } else {
        args[key] = true
      }
    } else {
      args._.push(item)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0] || 'help'
const baseUrl = String(args.url || process.env.AGENTROLES_URL || 'http://127.0.0.1:43110').replace(/\/+$/, '')
const token = String(args.token || process.env.AGENTROLES_TOKEN || '')

function usage() {
  process.stdout.write(
    [
      'AgentRoles CLI v' + VERSION,
      '',
      '用法：',
      '  agentroles agents',
      '  agentroles sessions --agent <名称或ID>',
      '  agentroles send --agent <名称或ID> --content <内容> [--session <会话ID或标题>] [--title <标题>] [--source <来源>] [--sender <发送者>]',
      '  agentroles health',
      '',
      '选项：',
      '  --url   本地接入地址，默认 http://127.0.0.1:43110',
      '  --token 访问 Token，或设置 AGENTROLES_TOKEN',
      '',
      '示例：',
      '  agentroles send --agent 需求记录员 --content "登录页改版，周五前完成" --source codex',
      ''
    ].join('\n')
  )
}

async function request(path, options = {}) {
  if (!token) {
    throw new Error('缺少 token。请传 --token 或设置 AGENTROLES_TOKEN。')
  }
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
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
    throw new Error(data?.error || 'HTTP ' + response.status + '：' + text.slice(0, 300))
  }
  return data
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function main() {
  if (command === 'help' || args.help) {
    usage()
    return
  }
  if (command === 'health') {
    const response = await fetch(baseUrl + '/health')
    process.stdout.write(JSON.stringify(await response.json(), null, 2) + '\n')
    return
  }
  if (command === 'agents') {
    const data = await request('/v1/agents')
    if (!Array.isArray(data.agents) || data.agents.length === 0) {
      process.stdout.write('还没有角色。\n')
      return
    }
    for (const agent of data.agents) {
      process.stdout.write(
        agent.name + '  [' + agent.id + ']\n  ' + (agent.tagline || '—') + '\n'
      )
    }
    return
  }
  if (command === 'sessions') {
    const agent = String(args.agent || '').trim()
    if (!agent) throw new Error('缺少 --agent')
    const data = await request('/v1/agents/' + encodeURIComponent(agent) + '/sessions')
    if (!Array.isArray(data.sessions) || data.sessions.length === 0) {
      process.stdout.write('该角色还没有会话。\n')
      return
    }
    for (const session of data.sessions) {
      process.stdout.write(session.title + '  [' + session.id + ']\n')
    }
    return
  }
  if (command === 'send') {
    const agent = String(args.agent || '').trim()
    if (!agent) throw new Error('缺少 --agent')
    let content = typeof args.content === 'string' ? args.content : ''
    if (!content) content = await readStdin()
    if (!content.trim()) throw new Error('缺少消息内容：用 --content 或通过 stdin 传入')
    const data = await request('/v1/agents/' + encodeURIComponent(agent) + '/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: content.trim(),
        title: typeof args.title === 'string' ? args.title : undefined,
        source: typeof args.source === 'string' ? args.source : 'cli',
        sender: typeof args.sender === 'string' ? args.sender : undefined,
        session: typeof args.session === 'string' ? args.session : undefined
      })
    })
    process.stdout.write(
      '已送达「' +
        agent +
        '」：消息 ' +
        (data.messageId || 'unknown') +
        (data.started ? '，已开始处理' : '，等待处理') +
        '\n'
    )
    return
  }
  usage()
  process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write('错误：' + (error?.message ?? String(error)) + '\n')
  process.exitCode = 1
})
