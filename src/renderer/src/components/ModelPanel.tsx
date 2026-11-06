import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Agent, ModelSettings, TestResult } from '@shared/types'
import { Field, InfoTip, SectionTitle, Spinner } from './Primitives'
import { Icon } from './Icons'

const PRESETS: Array<{
  id: string
  name: string
  hint: string
  provider: ModelSettings['provider']
  baseUrl: string
  model: string
  color: string
}> = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    hint: 'deepseek-chat / reasoner',
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    color: '#79c7ff'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    hint: 'Chat Completions',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5',
    color: '#9be6a8'
  },
  {
    id: 'codex',
    name: 'Codex',
    hint: 'Responses API',
    provider: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5-codex',
    color: '#c4a7ff'
  },
  {
    id: 'anthropic',
    name: 'Claude',
    hint: 'Anthropic Messages',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    color: '#ff9f7d'
  }
]

export function ModelPanel({
  agent,
  onSave,
  notify
}: {
  agent: Agent
  onSave: (agent: Agent) => Promise<Agent | null>
  notify: (kind: 'success' | 'error' | 'info', text: string) => void
}) {
  const [draft, setDraft] = useState<Agent>(agent)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [comboOpen, setComboOpen] = useState(false)
  const [comboSearch, setComboSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const comboRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraft(agent)
    setTest(null)
    setModels([])
    setModelsError('')
    setComboOpen(false)
    setComboSearch('')
  }, [agent])

  useEffect(() => {
    setModels([])
    setModelsError('')
    setComboOpen(false)
  }, [draft.model.provider, draft.model.baseUrl])

  useEffect(() => {
    const handleOutside = (event: MouseEvent): void => {
      if (!comboRef.current?.contains(event.target as Node)) {
        setComboOpen(false)
        setComboSearch('')
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  const dirty = JSON.stringify(draft.model) !== JSON.stringify(agent.model)
  const model = draft.model

  function update(patch: Partial<ModelSettings>): void {
    setDraft({ ...draft, model: { ...draft.model, ...patch } })
  }

  async function save(): Promise<void> {
    setSaving(true)
    const saved = await onSave(draft)
    setSaving(false)
    if (saved) setDraft(saved)
  }

  async function runTest(): Promise<void> {
    setTesting(true)
    setTest(null)
    try {
      const result = await window.api.testModel(draft.model)
      setTest(result)
    } catch (error: any) {
      setTest({ ok: false, message: error?.message ?? String(error) })
    } finally {
      setTesting(false)
    }
  }

  async function loadModels(): Promise<void> {
    setLoadingModels(true)
    setModelsError('')
    try {
      const result = await window.api.listModels(draft.model)
      if (!result.ok) {
        const message = result.message ?? '获取模型列表失败'
        setModelsError(message)
        notify('error', message)
        setComboOpen(true)
        return
      }
      setModels(result.models)
      setComboOpen(true)
      setComboSearch('')
      setActiveIndex(-1)
      notify('success', '已获取 ' + result.models.length + ' 个模型')
    } catch (error: any) {
      const message = error?.message ?? String(error)
      setModelsError(message)
      notify('error', message)
    } finally {
      setLoadingModels(false)
    }
  }

  const modelQuery = comboSearch.trim().toLowerCase()
  const filteredModels = (
    modelQuery
      ? models.filter((id) => id.toLowerCase().includes(modelQuery))
      : models
  ).slice(0, 100)

  function chooseModel(id: string): void {
    update({ model: id })
    setComboOpen(false)
    setComboSearch('')
    setActiveIndex(-1)
  }

  const activePreset = PRESETS.find(
    (preset) =>
      preset.provider === model.provider &&
      preset.baseUrl.replace(/\/$/, '') === model.baseUrl.replace(/\/$/, '')
  )

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>模型接入</h2>
          <p>每个角色使用独立的服务与密钥。切换角色时互不影响。</p>
        </div>
        <div className="panel-head-actions">
          <span className={'dirty-flag' + (dirty ? ' is-dirty' : '')}>
            {dirty ? '有未保存修改' : '已保存'}
          </span>
          <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存模型'}
          </button>
        </div>
      </div>

      <div className="panel-scroll">
        <section className="form-card">
          <SectionTitle title="服务预设" subtitle="选择预设只会覆盖服务地址与模型名，不会改动密钥。" />
          <div className="preset-grid">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={'preset-card' + (activePreset?.id === preset.id ? ' is-active' : '')}
                onClick={() =>
                  update({
                    provider: preset.provider,
                    baseUrl: preset.baseUrl,
                    model: preset.model
                  })
                }
              >
                <span className="preset-glyph" style={{ color: preset.color }}>
                  {preset.name.slice(0, 1)}
                </span>
                <span className="preset-copy">
                  <strong>{preset.name}</strong>
                  <span>{preset.hint}</span>
                </span>
                {activePreset?.id === preset.id ? (
                  <span className="preset-check">
                    <Icon name="check" size={13} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>

        <section className="form-card">
          <SectionTitle title="连接参数" subtitle="兼容 OpenAI Chat Completions 的服务填 Base URL 到 /v1 即可。" />
          <div className="form-grid">
            <Field label="接口协议">
              <select
                value={model.provider}
                onChange={(event) =>
                  update({ provider: event.target.value as ModelSettings['provider'] })
                }
              >
                <option value="openai">OpenAI 兼容（Chat Completions）</option>
                <option value="responses">OpenAI Responses（Codex / GPT-5）</option>
                <option value="anthropic">Anthropic Messages</option>
              </select>
            </Field>
            <div className="field">
              <span className="field-label">模型名称</span>
              <div className="model-name-row">
                <div className="combo" ref={comboRef}>
                  <input
                    className="combo-input"
                    value={model.model}
                    onChange={(event) => {
                      update({ model: event.target.value })
                      setComboSearch(event.target.value)
                      setComboOpen(true)
                      setActiveIndex(-1)
                    }}
                    onFocus={() => {
                      setComboOpen(true)
                      setComboSearch('')
                      setActiveIndex(-1)
                    }}
                    onClick={() => {
                      if (!comboOpen) {
                        setComboOpen(true)
                        setComboSearch('')
                        setActiveIndex(-1)
                      }
                    }}
                    role="combobox"
                    aria-expanded={comboOpen}
                    aria-autocomplete="list"
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setComboOpen(true)
                        if (filteredModels.length > 0) {
                          setActiveIndex((index) =>
                            Math.min(filteredModels.length - 1, index + 1)
                          )
                        }
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        setActiveIndex((index) => Math.max(0, index - 1))
                      } else if (event.key === 'Enter') {
                        if (comboOpen && activeIndex >= 0 && filteredModels[activeIndex]) {
                          event.preventDefault()
                          chooseModel(filteredModels[activeIndex])
                        } else if (comboOpen) {
                          setComboOpen(false)
                        }
                      } else if (event.key === 'Escape') {
                        setComboOpen(false)
                        setComboSearch('')
                      }
                    }}
                    placeholder="deepseek-chat"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className={'combo-toggle' + (comboOpen ? ' is-open' : '')}
                    onClick={() => {
                      setComboOpen((open) => !open)
                      setComboSearch('')
                      setActiveIndex(-1)
                    }}
                    aria-label="展开模型列表"
                    tabIndex={-1}
                  >
                    <Icon name="chevronDown" size={14} />
                  </button>

                  {comboOpen ? (
                    <div className="combo-menu" role="listbox">
                      {loadingModels ? (
                        <div className="combo-empty">
                          <Spinner size={12} /> 正在获取模型列表…
                        </div>
                      ) : models.length === 0 ? (
                        <div className="combo-empty">
                          {modelsError ||
                            '还没有模型列表。点击右侧「获取模型」，从服务端读取可用模型。'}
                        </div>
                      ) : filteredModels.length === 0 ? (
                        <div className="combo-empty">
                          没有匹配「{comboSearch.trim()}」的模型，可直接使用当前输入。
                        </div>
                      ) : (
                        filteredModels.map((id, index) => (
                          <button
                            key={id}
                            type="button"
                            className={
                              'combo-item' +
                              (index === activeIndex ? ' is-active' : '') +
                              (model.model === id ? ' is-selected' : '')
                            }
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => chooseModel(id)}
                            role="option"
                            aria-selected={model.model === id}
                          >
                            <span>{id}</span>
                            {model.model === id ? <Icon name="check" size={13} /> : null}
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm model-fetch"
                  onClick={() => void loadModels()}
                  disabled={loadingModels}
                  title="从服务端读取模型列表"
                >
                  {loadingModels ? <Spinner size={13} /> : <Icon name="refresh" size={13} />}
                  获取模型
                </button>
              </div>
              {modelsError && !comboOpen ? (
                <span className="field-hint field-error">{modelsError}</span>
              ) : null}
            </div>
          </div>

          <Field label="Base URL" hint="例如 https://api.deepseek.com/v1、https://api.openai.com/v1。">
            <input
              value={model.baseUrl}
              onChange={(event) => update({ baseUrl: event.target.value })}
              placeholder="https://api.deepseek.com/v1"
              spellCheck={false}
            />
          </Field>

          <Field label="API Key" hint="使用 Electron safeStorage 加密后保存在本机；不会上传到任何第三方。">
            <div className="secret-input">
              <input
                type={showKey ? 'text' : 'password'}
                value={model.apiKey}
                onChange={(event) => update({ apiKey: event.target.value })}
                placeholder="sk-…"
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowKey((value) => !value)}>
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
          </Field>

          <div className="form-grid">
            <div className="field">
              <div className="field-label-row">
                <label className="field-label" htmlFor="agent-temperature">
                  温度 · {model.temperature.toFixed(1)}
                </label>
                <InfoTip
                  title="温度 Temperature"
                  text="控制模型生成时的随机程度（不是智能程度）。调低更稳定、可复现，适合任务记录、信息抽取与工具调用；调高更多样，适合写作和头脑风暴。本应用范围 0–1.5；Claude 上限为 1，超出会自动截断；GPT-5 / Codex 等推理模型会忽略该参数。调高不会提升准确性，反而更容易跑题或编造。"
                />
              </div>
              <input
                id="agent-temperature"
                type="range"
                min={0}
                max={1.5}
                step={0.1}
                value={model.temperature}
                style={
                  {
                    '--range-fill': ((model.temperature / 1.5) * 100).toFixed(2) + '%'
                  } as CSSProperties
                }
                onChange={(event) => update({ temperature: Number(event.target.value) })}
              />
              <span className="field-hint">记录类角色建议 0.2–0.5，创意类可高一些。</span>
            </div>
            <Field label="最大输出 tokens">
              <input
                type="number"
                min={256}
                max={32000}
                step={256}
                value={model.maxTokens}
                onChange={(event) => update({ maxTokens: Number(event.target.value) || 4096 })}
              />
            </Field>
          </div>
        </section>

        <section className="form-card">
          <div className="test-row">
            <div>
              <h3>连接测试</h3>
              <p>用当前参数发一条极短的请求，确认地址、密钥与模型名都可用。</p>
            </div>
            <button className="btn btn-ghost" onClick={() => void runTest()} disabled={testing}>
              {testing ? <Spinner size={14} /> : <Icon name="plug" size={15} />}
              {testing ? '测试中…' : '测试连接'}
            </button>
          </div>
          {test ? (
            <div className={'test-result ' + (test.ok ? 'is-ok' : 'is-bad')}>
              <Icon name={test.ok ? 'check' : 'alert'} size={15} />
              <span>{test.message}</span>
              {test.latencyMs ? <span className="latency">{test.latencyMs}ms</span> : null}
            </div>
          ) : null}
        </section>

        <section className="form-card note-card">
          <Icon name="key" size={16} />
          <p>
            密钥只保存在本机。若使用本地模型（Ollama、LM Studio 等），把 Base URL 指向本机地址、Key
            留空即可。
          </p>
        </section>
      </div>
    </div>
  )
}
