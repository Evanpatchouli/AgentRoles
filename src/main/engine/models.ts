import type { ModelSettings } from '@shared/types'

function normalizeBase(model: ModelSettings): string {
  let base = (model.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('未配置 Base URL')
  base = base.replace(/\/(chat\/completions|responses|messages)$/i, '')
  return base
}

function modelsUrl(model: ModelSettings): string {
  const base = normalizeBase(model)
  if (model.provider === 'anthropic') {
    if (base.endsWith('/v1')) return base + '/models'
    if (/api\.anthropic\.com$/i.test(base)) return base + '/v1/models'
    return base + '/v1/models'
  }
  if (base.endsWith('/v1')) return base + '/models'
  if (/api\.openai\.com$/i.test(base)) return base + '/v1/models'
  return base + '/models'
}

function parseModels(payload: any): string[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []
  const ids: string[] = []
  for (const item of list) {
    const id =
      typeof item === 'string'
        ? item
        : typeof item?.id === 'string'
          ? item.id
          : typeof item?.name === 'string'
            ? item.name
            : ''
    if (id && !ids.includes(id)) ids.push(id)
    if (ids.length >= 400) break
  }
  return ids
}

export async function listModelsForProvider(model: ModelSettings): Promise<string[]> {
  const url = modelsUrl(model)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (model.provider === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    if (model.apiKey.trim()) headers['x-api-key'] = model.apiKey.trim()
  } else if (model.apiKey.trim()) {
    headers.Authorization = 'Bearer ' + model.apiKey.trim()
  }

  let response: Response
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20000)
    })
  } catch (error: any) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('获取模型列表超时（20 秒），请检查 Base URL 是否可访问')
    }
    throw new Error('无法连接模型服务 ' + url + '：' + (error?.message ?? String(error)))
  }

  const text = await response.text()
  let payload: any = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const detail =
      payload?.error?.message || payload?.message || text.slice(0, 400) || '未知错误'
    const hint =
      response.status === 401 || response.status === 403
        ? '（请检查 API Key）'
        : response.status === 404
          ? '（该服务可能不提供 /models 接口，请手动输入模型名）'
          : ''
    throw new Error('获取模型列表失败：HTTP ' + response.status + ' ' + detail + hint)
  }

  const models = parseModels(payload)
  if (models.length === 0) {
    throw new Error('服务返回的模型列表为空，请手动输入模型名')
  }
  return models
}
