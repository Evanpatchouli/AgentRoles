import { useEffect, useState } from 'react'
import type { Agent, AppSettings, SkillMeta } from '@shared/types'
import { Icon } from './Icons'
import { RiskBadge, Toggle } from './Primitives'

function ImportedSkillMeta({ skill }: { skill: SkillMeta }) {
  const remote = Boolean(skill.origin && /^https?:\/\//i.test(skill.origin))
  return (
    <div className="skill-meta">
      <span className="badge badge-muted">{remote ? '远程导入' : '本地导入'}</span>
      <span className="muted">{skill.fileCount ?? 0} 个文件</span>
      {skill.scripts && skill.scripts.length > 0 ? (
        <span className="badge badge-warn">{skill.scripts.length} 个脚本</span>
      ) : null}
      {skill.version ? <span className="muted">v{skill.version}</span> : null}
      <span className="skill-origin mono" title={skill.origin}>
        {skill.origin}
      </span>
    </div>
  )
}

export function SkillsPanel({
  agent,
  skills,
  settings,
  onSave,
  notify,
  onImportFolder,
  onImportUrl,
  onRemoveSkill,
  onRevealSkill
}: {
  agent: Agent
  skills: SkillMeta[]
  settings: AppSettings
  onSave: (agent: Agent) => Promise<Agent | null>
  notify: (kind: 'success' | 'error' | 'info', text: string) => void
  onImportFolder: () => Promise<boolean>
  onImportUrl: (url: string) => Promise<boolean>
  onRemoveSkill: (skill: SkillMeta) => void
  onRevealSkill: (skill: SkillMeta) => void
}) {
  const [draft, setDraft] = useState<Agent>(agent)
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  useEffect(() => {
    setDraft(agent)
  }, [agent])

  useEffect(() => {
    if (!importOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !importing) setImportOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [importOpen, importing])

  const dirty = JSON.stringify(draft.skills) !== JSON.stringify(agent.skills)
  const enabledCount = skills.filter((skill) => draft.skills[skill.id]?.enabled).length
  const builtinSkills = skills.filter((skill) => skill.kind !== 'imported')
  const importedSkills = skills.filter((skill) => skill.kind === 'imported')

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

  async function importFolder(): Promise<void> {
    if (importing) return
    setImporting(true)
    try {
      await onImportFolder()
    } finally {
      setImporting(false)
    }
  }

  async function submitUrl(): Promise<void> {
    const value = importUrl.trim()
    if (!value) {
      setImportError('请输入技能包地址')
      return
    }
    setImporting(true)
    setImportError('')
    try {
      const ok = await onImportUrl(value)
      if (ok) {
        setImportOpen(false)
        setImportUrl('')
      }
    } catch (error: any) {
      setImportError(error?.message ?? String(error))
    } finally {
      setImporting(false)
    }
  }

  function renderImportActions() {
    return (
      <div className="skill-import-actions">
        <button
          className="btn btn-ghost btn-sm"
          disabled={importing}
          onClick={() => void importFolder()}
        >
          <Icon name="folder" size={14} />
          导入本地技能
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={importing}
          onClick={() => {
            setImportError('')
            setImportOpen(true)
          }}
        >
          <Icon name="globe" size={14} />
          从链接导入
        </button>
      </div>
    )
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
        <div className="skill-section-head">
          <div>
            <h3>内置技能</h3>
            <p>随应用提供、由代码实现的工具能力。</p>
          </div>
        </div>

        <div className="skill-list">
          {builtinSkills.map((skill) => {
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

        <div className="skill-section-head skill-section-custom">
          <div>
            <h3>自定义技能</h3>
            <p>导入以 SKILL.md 为入口的技能包，说明会进入这个角色的提示词。</p>
          </div>
          {renderImportActions()}
        </div>

        {importedSkills.length > 0 ? (
          <div className="skill-list">
            {importedSkills.map((skill) => {
              const state = draft.skills[skill.id] ?? { enabled: false, settings: {} }
              return (
                <section
                  key={skill.id}
                  className={
                    'skill-card skill-card-imported' + (state.enabled ? ' is-enabled' : '')
                  }
                >
                  <div className="skill-head">
                    <span className="skill-icon">{skill.icon}</span>
                    <div className="skill-copy">
                      <div className="skill-title-row">
                        <h3>{skill.name}</h3>
                        <span className="badge badge-muted">导入</span>
                      </div>
                      <p className="skill-desc" title={skill.description}>
                        {skill.description}
                      </p>
                    </div>
                    <Toggle
                      checked={state.enabled}
                      onChange={(value) => setSkill(skill.id, { enabled: value })}
                    />
                  </div>

                  <ImportedSkillMeta skill={skill} />

                  <div className="skill-tools">
                    {skill.toolNames.map((name) => (
                      <code key={name}>{name}</code>
                    ))}
                  </div>

                  {skill.scripts && skill.scripts.length > 0 ? (
                    <div className="skill-global-hint">
                      <Icon name="terminal" size={13} />
                      <span className="muted">
                        包内含脚本；需要该角色同时启用「终端命令」技能后才能运行。
                      </span>
                    </div>
                  ) : null}

                  <div className="skill-actions">
                    <button className="link-btn" onClick={() => onRevealSkill(skill)}>
                      <Icon name="folder" size={13} />
                      打开技能目录
                    </button>
                    <button className="link-btn link-danger" onClick={() => onRemoveSkill(skill)}>
                      <Icon name="trash" size={13} />
                      删除技能
                    </button>
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <div className="skill-empty">
            <span className="skill-empty-icon">
              <Icon name="sparkle" size={18} />
            </span>
            <div>
              <strong>还没有导入自定义技能</strong>
              <p>
                导入一个包含 SKILL.md 的文件夹，或从 GitHub 仓库 / ZIP 链接导入。导入后所有角色都可以单独启用。
              </p>
            </div>
          </div>
        )}

        <div className="panel-note">
          <Icon name="alert" size={15} />
          技能工具在主进程执行，拥有操作本机文件与网络的能力。高风险技能只应在你信任的角色上启用。导入的技能包只提供说明与参考文件，不会自动执行其中的脚本。
        </div>
      </div>

      {importOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!importing) setImportOpen(false)
          }}
        >
          <div
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>从链接导入技能</h3>
            <p>
              支持 GitHub 仓库、仓库内子目录（/tree/分支/路径）以及任意 ZIP 下载链接。技能包根目录需要包含 SKILL.md。
            </p>
            <label className="field">
              <span className="field-label">技能包地址</span>
              <input
                autoFocus
                value={importUrl}
                spellCheck={false}
                placeholder="https://github.com/owner/repo"
                onChange={(event) => setImportUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitUrl()
                }}
              />
              {importError ? <span className="field-hint field-error">{importError}</span> : null}
            </label>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                disabled={importing}
                onClick={() => setImportOpen(false)}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={importing || !importUrl.trim()}
                onClick={() => void submitUrl()}
              >
                {importing ? '导入中…' : '导入'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
