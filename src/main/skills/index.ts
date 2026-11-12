import type { Agent, AppSettings, SkillMeta, SkillState } from '@shared/types'
import { defaultSkillState } from '../defaults'
import type { MemoryStore } from '../memory/store'
import type { SkillDefinition, ToolContext, ToolSpec } from './types'
import { notionSkill } from './notion'
import { memorySkill } from './memory'
import { filesystemSkill } from './filesystem'
import { httpSkill } from './http'
import { shellSkill } from './shell'

export const SKILLS: SkillDefinition[] = [
  notionSkill,
  memorySkill,
  filesystemSkill,
  httpSkill,
  shellSkill
]

const SKILL_MAP = new Map(SKILLS.map((skill) => [skill.id, skill]))

export function getSkill(id: string): SkillDefinition | undefined {
  return SKILL_MAP.get(id)
}

export function defaultSkillStates(): Record<string, SkillState> {
  const states: Record<string, SkillState> = {}
  for (const skill of SKILLS) states[skill.id] = defaultSkillState(skill.id)
  return states
}

export function skillMetas(): SkillMeta[] {
  return SKILLS.map((skill) => ({
    id: skill.id,
    name: skill.name,
    icon: skill.icon,
    description: skill.description,
    risk: skill.risk,
    settings: skill.settings,
    toolNames: skill.tools.map((tool) => tool.name)
  }))
}

export interface ToolBuildOptions {
  agent: Agent
  settings: AppSettings
  dataDir: string
  signal: AbortSignal
  memory: MemoryStore
  sessionId?: string
  sourceMessageId?: string
}

export function buildToolContext(options: ToolBuildOptions): ToolContext {
  return {
    agent: options.agent,
    settings: options.settings,
    dataDir: options.dataDir,
    workspaceDir: options.settings.workspaceDir,
    signal: options.signal,
    memory: options.memory,
    sessionId: options.sessionId,
    sourceMessageId: options.sourceMessageId
  }
}

export function buildToolsForAgent(options: ToolBuildOptions): {
  tools: ToolSpec[]
  context: ToolContext
} {
  const context = buildToolContext(options)
  const tools: ToolSpec[] = []
  for (const skill of SKILLS) {
    if (!options.agent.skills[skill.id]?.enabled) continue
    tools.push(...skill.tools)
  }
  return { tools, context }
}

export function buildSkillPrompt(agent: Agent): string {
  const enabled = SKILLS.filter((skill) => agent.skills[skill.id]?.enabled)
  if (enabled.length === 0) return '当前没有启用任何技能，你只能通过文字回复。'
  return enabled
    .map((skill) => {
      const lines = ['### ' + skill.name + '（' + skill.id + '）', skill.description]
      if (skill.hint) lines.push('使用要点：' + skill.hint)
      return lines.join('\n')
    })
    .join('\n\n')
}
