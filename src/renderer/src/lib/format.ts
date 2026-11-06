export const SOURCE_LABEL: Record<string, string> = {
  app: '本机',
  http: 'HTTP',
  mcp: 'MCP',
  cli: 'CLI',
  codex: 'Codex',
  'claude-code': 'Claude Code',
  dsh: 'DSH',
  system: '系统'
}

export const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI 兼容',
  responses: 'OpenAI Responses',
  anthropic: 'Anthropic'
}

export function sourceLabel(source?: string): string {
  if (!source) return '本机'
  return SOURCE_LABEL[source] ?? source
}

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

export function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  })
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 45_000) return '刚刚'
  if (diff < 3_600_000) return Math.max(1, Math.floor(diff / 60_000)) + ' 分钟前'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前'
  if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + ' 天前'
  return dateLabel(ts)
}

export function truncate(text: string, max = 120): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > max ? compact.slice(0, max) + '…' : compact
}

export function prettyToolName(name: string): string {
  const map: Record<string, string> = {
    notion_create_task: '创建 Notion 任务',
    notion_update_task: '更新 Notion 任务',
    notion_find_task: '查找 Notion 任务',
    notion_get_database: '读取数据库结构',
    notion_query_database: '查询 Notion 数据库',
    notion_create_page: '创建 Notion 页面',
    notion_update_page: '更新 Notion 页面',
    notion_get_page: '读取 Notion 页面',
    notion_search: '搜索 Notion',
    memory_set: '写入长期记忆',
    memory_get: '读取长期记忆',
    memory_list: '列出长期记忆',
    memory_delete: '删除长期记忆',
    fs_list: '列出目录',
    fs_read: '读取文件',
    fs_write: '写入文件',
    fs_append: '追加文件',
    http_request: '发送 HTTP 请求',
    run_command: '执行终端命令'
  }
  return map[name] ?? name
}

export function toolIcon(name: string): string {
  if (name.startsWith('notion_')) return 'N'
  if (name.startsWith('memory_')) return '◉'
  if (name.startsWith('fs_')) return '▤'
  if (name === 'http_request') return '⇄'
  if (name === 'run_command') return '❯'
  return '⚙'
}
