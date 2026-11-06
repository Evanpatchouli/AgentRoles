import { useEffect, useRef, useState } from 'react'
import type { Agent } from '@shared/types'
import { Field, SectionTitle, Spinner, Toggle } from './Primitives'
import { Icon } from './Icons'
import { AvatarContent } from './Avatar'

const COLORS = [
  { value: '#c9f36b', name: '青柠绿', hint: '明亮黄绿' },
  { value: '#79c7ff', name: '天蓝', hint: '清透浅蓝' },
  { value: '#ff9f7d', name: '珊瑚橙', hint: '暖橙偏粉' },
  { value: '#c4a7ff', name: '薰衣草紫', hint: '柔和浅紫' },
  { value: '#6fe0c2', name: '薄荷青', hint: '清亮蓝绿' },
  { value: '#ffd166', name: '暖黄', hint: '明亮金黄' },
  { value: '#f78fb3', name: '樱花粉', hint: '柔和粉红' },
  { value: '#9be6a8', name: '浅草绿', hint: '柔和浅绿' }
]

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const AVATAR_MAX_BYTES = 8 * 1024 * 1024

function normalizeAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取文件'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('无法解析图片'))
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('图片尺寸异常'))
          return
        }
        const size = 256
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('无法创建画布'))
          return
        }
        const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight)
        const width = image.naturalWidth * scale
        const height = image.naturalHeight * scale
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
        resolve(canvas.toDataURL('image/webp', 0.9))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

const TEMPLATES = [
  {
    id: 'recorder',
    name: '需求记录员',
    avatar: '◈',
    tagline: '接住每一条需求，沉淀到 Notion',
    notion: true,
    role: `你是一名需求与任务记录员，负责把用户或其他 AI Agent 发来的消息整理成结构化任务，并记录到 Notion。

工作方式：
1. 判断消息类型：新需求 / 进展更新 / 阻塞风险 / 普通讨论。
2. 新需求：提炼标题、背景与验收标准，调用 notion_create_task 创建任务；信息不足时先记录已知内容，并在回复末尾列出待确认项。
3. 状态更新：先用 notion_find_task 定位任务，再调用 notion_update_task 更新状态或补充进展。
4. 一条消息包含多件事时，拆成多个任务。
5. 每次操作后简短汇报：做了什么、任务链接、待确认事项。
6. 不确定字段或状态选项时先查询，不要臆造。`
  },
  {
    id: 'reviewer',
    name: '代码评审员',
    avatar: '⌘',
    tagline: '只看真正会出问题的地方',
    notion: false,
    role: `你是一名严格的代码评审员。你的目标是发现会导致线上问题、难以维护或难以测试的改动，而不是堆砌风格建议。

工作方式：
1. 先读改动涉及的上下文，理解意图与约束，再下判断。
2. 按严重程度输出问题：阻断 / 建议 / 疑问，每条给出具体位置、原因与修复方向。
3. 重点检查边界条件、并发与异步、错误处理、权限与数据校验、资源泄漏、兼容性。
4. 明确区分「必须改」和「可以接受」，不要用个人偏好制造噪音。
5. 如果整体可以合并，明确说明；如果不行，说明最小阻断项。`
  },
  {
    id: 'researcher',
    name: '研究助理',
    avatar: '◎',
    tagline: '把问题拆开，找到可信答案',
    notion: false,
    role: `你是一名研究助理，擅长把模糊问题拆成可验证的子问题，并给出有出处的结论。

工作方式：
1. 先澄清问题边界与成功标准；信息不足时列出假设。
2. 拆解为若干子问题，优先查一手资料；需要联网时使用可用工具。
3. 区分事实、推断与观点，重要结论附上来源链接。
4. 输出结构：结论先行 → 关键证据 → 反例与风险 → 下一步建议。
5. 不确定的地方直接说不确定，不要编造引用。`
  },
  {
    id: 'ops',
    name: '交付协调员',
    avatar: '◇',
    tagline: '盯住进度，提前暴露风险',
    notion: false,
    role: `你是一名交付协调员，负责跟踪任务进展、识别阻塞并推动事情闭环。

工作方式：
1. 维护清晰的任务状态：待开始 / 进行中 / 待验收 / 已完成 / 阻塞。
2. 主动追问缺失的信息：负责人、截止时间、验收标准。
3. 发现风险时，先说明影响，再给出两到三个可选方案。
4. 对外汇报使用简短结构化格式，不写流水账。
5. 没有依据不更新状态，不用「大概完成了」这类描述。`
  }
]

export function RolePanel({
  agent,
  onSave,
  onDelete,
  notify
}: {
  agent: Agent
  onSave: (agent: Agent) => Promise<Agent | null>
  onDelete: (agent: Agent) => void
  notify: (kind: 'success' | 'error' | 'info', text: string) => void
}) {
  const [draft, setDraft] = useState<Agent>(agent)
  const [saving, setSaving] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(agent)
  }, [agent])

  const dirty = JSON.stringify(draft) !== JSON.stringify(agent)
  const activeColor = COLORS.find((color) => color.value === draft.color)

  async function save(): Promise<void> {
    setSaving(true)
    const saved = await onSave(draft)
    setSaving(false)
    if (saved) setDraft(saved)
  }

  async function handleAvatarFile(file: File | undefined): Promise<void> {
    if (!file) return
    if (!AVATAR_TYPES.includes(file.type)) {
      notify('error', '请选择 PNG / JPG / WebP 图片')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      notify('error', '图片不能超过 8MB')
      return
    }
    setAvatarBusy(true)
    try {
      const avatarImage = await normalizeAvatar(file)
      setDraft((current) => ({ ...current, avatarImage }))
      notify('success', '头像已更新，保存角色后生效')
    } catch {
      notify('error', '图片处理失败，请换一张图片试试')
    } finally {
      setAvatarBusy(false)
    }
  }

  function applyTemplate(template: (typeof TEMPLATES)[number]): void {
    setDraft((current) => {
      const next: Agent = {
        ...current,
        name: template.name,
        avatar: template.avatar,
        avatarImage: undefined,
        tagline: template.tagline,
        role: template.role,
        skills: { ...current.skills }
      }
      if (template.notion && next.skills.notion) {
        next.skills.notion = { ...next.skills.notion, enabled: true }
      }
      return next
    })
    notify('info', '已套用「' + template.name + '」模板，记得保存')
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>角色设定</h2>
          <p>职责描述会作为 system prompt 的主体。写清工作方式、边界与输出格式，比写「你很专业」有用得多。</p>
        </div>
        <div className="panel-head-actions">
          <span className={'dirty-flag' + (dirty ? ' is-dirty' : '')}>
            {dirty ? '有未保存修改' : '已保存'}
          </span>
          <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存角色'}
          </button>
        </div>
      </div>

      <div className="panel-scroll">
        <section className="form-card">
          <div className="form-grid">
            <Field label="角色名称">
              <input
                value={draft.name}
                maxLength={40}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="例如：需求记录员"
              />
            </Field>
            <div className="field">
              <span className="field-label">头像</span>
              <div className="avatar-editor">
                <div
                  className="avatar-preview"
                  style={{
                    color: draft.color,
                    borderColor: draft.color + '55',
                    background: draft.color + '14'
                  }}
                >
                  <AvatarContent agent={draft} />
                </div>
                <div className="avatar-editor-copy">
                  <div className="avatar-editor-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={avatarBusy}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      {avatarBusy ? <Spinner size={13} /> : <Icon name="image" size={14} />}
                      {avatarBusy ? '处理中…' : '上传图片'}
                    </button>
                    {draft.avatarImage ? (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setDraft({ ...draft, avatarImage: undefined })}
                      >
                        移除图片
                      </button>
                    ) : null}
                  </div>
                  <div className="avatar-symbol-row">
                    <span className="field-hint">或使用符号</span>
                    <input
                      className="avatar-symbol-input"
                      value={draft.avatar}
                      maxLength={4}
                      onChange={(event) => setDraft({ ...draft, avatar: event.target.value })}
                      placeholder="◈"
                    />
                  </div>
                  <span className="field-hint">PNG / JPG / WebP，自动裁成 256×256，建议不超过 8MB。</span>
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    void handleAvatarFile(file)
                  }}
                />
              </div>
            </div>
          </div>

          <Field label="一句话职责" hint="展示在角色列表与标题区。">
            <input
              value={draft.tagline}
              maxLength={60}
              onChange={(event) => setDraft({ ...draft, tagline: event.target.value })}
              placeholder="例如：接住每一条需求，沉淀到 Notion"
            />
          </Field>

          <Field
            label="强调色"
            hint={
              activeColor
                ? '用于头像与界面点缀。当前：' +
                  activeColor.name +
                  ' · ' +
                  activeColor.value.toUpperCase()
                : '用于头像与界面点缀。'
            }
          >
            <div className="swatches">
              {COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={'swatch' + (draft.color === color.value ? ' is-active' : '')}
                  style={{ background: color.value }}
                  onClick={() => setDraft({ ...draft, color: color.value })}
                  aria-label={
                    '选择强调色：' + color.name + '，' + color.hint + '，' + color.value.toUpperCase()
                  }
                  aria-pressed={draft.color === color.value}
                >
                  <span className="swatch-tooltip" role="tooltip">
                    <span className="swatch-tooltip-name">{color.name}</span>
                    <span className="swatch-tooltip-meta">
                      {color.hint} · {color.value.toUpperCase()}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </Field>
        </section>

        <section className="form-card">
          <SectionTitle
            title="职责描述"
            subtitle="这是角色的核心。建议包含：目标、输入来源、工作步骤、边界与输出格式。"
          />
          <div className="template-row">
            <span className="template-label">从模板开始</span>
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                className="template-chip"
                onClick={() => applyTemplate(template)}
              >
                <span className="template-avatar">{template.avatar}</span>
                {template.name}
              </button>
            ))}
          </div>
          <textarea
            className="role-textarea"
            rows={15}
            value={draft.role}
            onChange={(event) => setDraft({ ...draft, role: event.target.value })}
            placeholder="描述这个角色负责什么、如何工作、什么时候该停下来确认…"
          />
          <div className="char-count">{draft.role.length} 字符</div>
        </section>

        <section className="form-card inline-card">
          <div>
            <h3>自动处理外部消息</h3>
            <p>
              收到 HTTP / MCP / CLI 消息后立即开始处理。关闭后，消息会留在收件箱，等你确认后再交给它。
            </p>
          </div>
          <Toggle
            checked={draft.autoRun}
            onChange={(value) => setDraft({ ...draft, autoRun: value })}
          />
        </section>

        <section className="danger-card">
          <div>
            <h3>删除这个角色</h3>
            <p>同时删除它的会话、长期记忆与技能配置，不可恢复。</p>
          </div>
          <button className="btn btn-danger-ghost" onClick={() => onDelete(agent)}>
            <Icon name="trash" size={14} />
            删除角色
          </button>
        </section>
      </div>
    </div>
  )
}
