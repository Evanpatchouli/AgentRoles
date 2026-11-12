import { randomBytes, randomUUID } from 'node:crypto'
import type { Agent, AppSettings, ModelSettings, SkillState } from '@shared/types'

export const AGENT_COLORS = [
  '#c9f36b',
  '#79c7ff',
  '#ff9f7d',
  '#c4a7ff',
  '#6fe0c2',
  '#ffd166',
  '#f78fb3',
  '#9be6a8'
]

export const RECORDER_ROLE = `你是一名「需求与任务记录员」。你的职责是接住来自用户或其他 AI Agent（如 Codex、Claude Code、DSH）的消息，将其整理成可执行的需求与任务，并可靠地记录到 Notion。

## 工作方式
1. 收到消息后，先判断类型：新需求 / 任务进展 / 阻塞风险 / 普通讨论。
2. 新需求：提炼标题、背景与验收标准，调用 notion_create_task 创建任务。标题要短而具体，背景与验收标准写进正文。信息不足时，先记录已知部分，并在回复末尾列出「待确认」。
3. 进展或状态变化：先用 notion_find_task 找到对应任务，确认无误后调用 notion_update_task 更新状态，再把关键进展补充到正文。
4. 一条消息包含多件事时，拆成多个任务，而不是堆在一条记录里。
5. 每次操作后用一到两句话汇报：做了什么、任务链接、待确认事项。
6. 不确定任务 ID、状态选项或数据库字段时，先查询，不要臆造。
7. 外部 Agent 的消息可能很简短，保留其原始意图，不要过度改写或扩写需求。

## 边界
- 只记录与任务相关的事实，不虚构优先级、截止时间或负责人。
- 涉及删除、归档任务时先向用户确认。
- Notion 不可用时，明确说明失败原因，并把内容完整留在对话里，便于稍后重试。`

export const RECORDER_TAGLINE = '接住每一条需求，沉淀到 Notion'

export function defaultModel(): ModelSettings {
  return {
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.6,
    maxTokens: 4096
  }
}

export function defaultSkillState(skillId: string): SkillState {
  switch (skillId) {
    case 'notion':
      return {
        enabled: false,
        settings: {
          databaseId: '',
          titleProperty: '',
          statusProperty: '',
          priorityProperty: '',
          dueProperty: '',
          token: ''
        }
      }
    case 'memory':
      return { enabled: true, settings: {} }
    case 'filesystem':
      return { enabled: false, settings: { subdir: '' } }
    case 'http':
      return { enabled: false, settings: {} }
    case 'shell':
      return { enabled: false, settings: {} }
    default:
      return { enabled: false, settings: {} }
  }
}

export function defaultSettings(workspaceDir: string): AppSettings {
  return {
    notion: { token: '', databaseId: '' },
    ingress: {
      enabled: true,
      port: 43110,
      token: randomBytes(16).toString('hex')
    },
    memory: {
      extractionEnabled: false,
      autoAcceptConfidence: 0.85,
      embedding: {
        enabled: false,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'text-embedding-3-small'
      }
    },
    workspaceDir,
    theme: 'system'
  }
}

export function createAgent(
  overrides: Partial<Agent> = {},
  skillIds: string[] = []
): Agent {
  const now = Date.now()
  const skills: Record<string, SkillState> = {}
  for (const id of skillIds) skills[id] = defaultSkillState(id)
  const agent: Agent = {
    id: randomUUID(),
    name: '新角色',
    avatar: '✦',
    color: AGENT_COLORS[Math.floor(Math.random() * AGENT_COLORS.length)],
    tagline: '',
    role: '你是一名专业、可靠的助手。清楚地说明你的判断依据，并在行动前确认关键信息。',
    model: defaultModel(),
    skills,
    autoRun: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
  agent.skills = { ...skills, ...(overrides.skills ?? {}) }
  return agent
}

export function createRecorderAgent(skillIds: string[]): Agent {
  const agent = createAgent(
    {
      name: '需求记录员',
      avatar: '◈',
      color: AGENT_COLORS[0],
      tagline: RECORDER_TAGLINE,
      role: RECORDER_ROLE,
      autoRun: true
    },
    skillIds
  )
  agent.skills.notion = { ...defaultSkillState('notion'), enabled: true }
  agent.skills.memory = { enabled: true, settings: {} }
  return agent
}
