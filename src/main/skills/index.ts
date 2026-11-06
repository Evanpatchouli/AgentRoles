import type { Agent, AppSettings, SkillMeta, SkillState } from '@shared/types'
import { defaultSkillState } from '../defaults'
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

export function buildToolContext(
  agent: Agent,
  settings: AppSettings,
  dataDir: string,
  signal: AbortSignal
): ToolContext {
  return {
    agent,
    settings,
    dataDir,
    workspaceDir: settings.workspaceDir,
    signal
  }
}

export function buildToolsForAgent(
  agent: Agent,
  settings: AppSettings,
  dataDir: string,
  signal: AbortSignal
): { tools: ToolSpec[]; context: ToolContext } {
  const context = buildToolContext(agent, settings, dataDir, signal)
  const tools: ToolSpec[] = []
  for (const skill of SKILLS) {
    if (!agent.skills[skill.id]?.enabled) continue
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
