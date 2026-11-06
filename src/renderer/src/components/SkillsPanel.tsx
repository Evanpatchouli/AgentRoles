import { useEffect, useState } from 'react'
import type { Agent, AppSettings, SkillMeta } from '@shared/types'
import { Icon } from './Icons'
import { RiskBadge, Toggle } from './Primitives'

export function SkillsPanel({
  agent,
  skills,
  settings,
  onSave,
  notify
}: {
  agent: Agent
  skills: SkillMeta[]
  settings: AppSettings
  onSave: (agent: Agent) => Promise<Agent | null>
  notify: (kind: 'success' | 'error' | 'info', text: string) => void
}) {
  const [draft, setDraft] = useState<Agent>(agent)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(agent)
  }, [agent])

  const dirty = JSON.stringify(draft.skills) !== JSON.stringify(agent.skills)
  const enabledCount = skills.filter((skill) => draft.skills[skill.id]?.enabled).length

  async function save(): Promise<void> {
    setSaving(true)
    const saved = await onSave(draft)
    setSaving(false)
    if (saved) setDraft(saved)
  }

  function setSkill(id: string, next: { enabled?: boolean; settings?: Record<string, string> }): void {
    const current = draft.skills[id] ?? { enabled: false, settings: {} }
    setDraft({
      ...draft,
      skills: {
        ...draft.skills,
        [id]: {
          enabled: next.enabled ?? current.enabled,
          settings: { ...current.settings, ...(next.settings ?? {}) }
        }
      }
    })
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>技能</h2>
          <p>
            技能决定这个角色能做什么。每个角色独立启停、独立配置，共 {enabledCount} 个技能已启用。
          </p>
        </div>
        <div className="panel-head-actions">
          <span className={'dirty-flag' + (dirty ? ' is-dirty' : '')}>
            {dirty ? '有未保存修改' : '已保存'}
          </span>
          <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存技能配置'}
          </button>
        </div>
      </div>

      <div className="panel-scroll">
        <div className="skill-list">
          {skills.map((skill) => {
            const state = draft.skills[skill.id] ?? { enabled: false, settings: {} }
            return (
              <section
                key={skill.id}
                className={'skill-card' + (state.enabled ? ' is-enabled' : '')}
              >
                <div className="skill-head">
                  <span className="skill-icon">{skill.icon}</span>
                  <div className="skill-copy">
                    <div className="skill-title-row">
                      <h3>{skill.name}</h3>
                      <RiskBadge risk={skill.risk} />
                    </div>
                    <p>{skill.description}</p>
                  </div>
                  <Toggle
                    checked={state.enabled}
                    onChange={(value) => setSkill(skill.id, { enabled: value })}
                  />
                </div>

                <div className="skill-tools">
                  {skill.toolNames.map((name) => (
                    <code key={name}>{name}</code>
                  ))}
                </div>

                {state.enabled && skill.settings.length > 0 ? (
                  <div className="skill-settings">
                    {skill.id === 'notion' ? (
                      <div className="skill-global-hint">
                        <span
                          className={
                            'badge ' + (settings.notion.token ? 'badge-ok' : 'badge-muted')
                          }
                        >
                          {settings.notion.token ? '全局 Token 已配置' : '全局 Token 未配置'}
                        </span>
                        <span className="muted">
                          {settings.notion.databaseId
                            ? '默认数据库：' + settings.notion.databaseId
                            : '未设置默认数据库'}
                        </span>
                        <button
                          className="link-btn"
                          onClick={() => notify('info', '在左侧「设置 → Notion 集成」里填写全局配置')}
                        >
                          去哪里配置？
                        </button>
                      </div>
                    ) : null}
                    {skill.id === 'filesystem' ? (
                      <div className="skill-global-hint">
                        <span className="badge badge-muted">工作区</span>
                        <span className="muted mono">{settings.workspaceDir}</span>
                      </div>
                    ) : null}
                    <div className="skill-settings-grid">
                      {skill.settings.map((field) => (
                        <label
                          key={field.key}
                          className={'field' + (field.help ? ' field-wide' : '')}
                        >
                          <span className="field-label">{field.label}</span>
                          {field.multiline ? (
                            <textarea
                              rows={3}
                              value={state.settings[field.key] ?? ''}
                              placeholder={field.placeholder}
                              onChange={(event) =>
                                setSkill(skill.id, {
                                  settings: { [field.key]: event.target.value }
                                })
                              }
                            />
                          ) : (
                            <input
                              type={field.secret ? 'password' : 'text'}
                              value={state.settings[field.key] ?? ''}
                              placeholder={field.placeholder}
                              spellCheck={false}
                              onChange={(event) =>
                                setSkill(skill.id, {
                                  settings: { [field.key]: event.target.value }
                                })
                              }
                            />
                          )}
                          {field.help ? <span className="field-hint">{field.help}</span> : null}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {state.enabled && skill.settings.length === 0 ? (
                  <div className="skill-global-hint">
                    <Icon name="check" size={13} />
                    <span className="muted">启用后即可使用，无需额外配置。</span>
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>

        <div className="panel-note">
          <Icon name="alert" size={15} />
          技能工具在主进程执行，拥有操作本机文件与网络的能力。高风险技能只应在你信任的角色上启用。
        </div>
      </div>
    </div>
  )
}
