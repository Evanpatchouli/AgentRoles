import type { EmbeddingSettings } from '@shared/types'

export interface EmbeddingResult {
  vectors: Float32Array[]
  model: string
  dimensions: number
}

export function embeddingConfigured(settings?: EmbeddingSettings | null): boolean {
  return Boolean(
    settings?.enabled &&
      String(settings.baseUrl ?? '').trim() &&
      String(settings.model ?? '').trim()
  )
}

export function embeddingEndpoint(baseUrl: string): string {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('未配置 Embedding Base URL')
  if (base.endsWith('/embeddings')) return base
  return base + '/embeddings'
}

/** OpenAI 兼容的 /embeddings 客户端。关闭或未配置时调用方应回退到 FTS。 */
export async function embedTexts(
  settings: EmbeddingSettings,
  texts: string[],
  signal?: AbortSignal
): Promise<EmbeddingResult> {
  if (!embeddingConfigured(settings)) {
    throw new Error('Embedding 未启用或配置不完整')
  }
  const input = texts.map((text) => String(text ?? '').slice(0, 20000))
  if (input.length === 0) {
    return { vectors: [], model: settings.model, dimensions: 0 }
  }

  const url = embeddingEndpoint(settings.baseUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = String(settings.apiKey ?? '').trim()
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey

  const timeout = AbortSignal.timeout(45000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      signal: combined,
      body: JSON.stringify({ model: settings.model, input })
    })
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Embedding 请求超时或被取消（45 秒）')
    }
    throw new Error('无法连接 Embedding 服务 ' + url + '：' + (error?.message ?? String(error)))
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    let detail = raw.slice(0, 500)
    try {
      const parsed = JSON.parse(raw)
      detail = parsed?.error?.message || parsed?.message || detail
    } catch {
      /* keep raw */
    }
    const hint =
      response.status === 401 || response.status === 403
        ? '（请检查 API Key 是否有权限）'
        : response.status === 404
          ? '（请检查 Base URL 与 Embedding 模型名称）'
          : ''
    throw new Error(
      'Embedding 请求失败：HTTP ' + response.status + ' ' + detail + hint
    )
  }

  let payload: any
  try {
    payload = await response.json()
  } catch {
    throw new Error('Embedding 服务返回的不是合法 JSON')
  }
  const data = Array.isArray(payload?.data) ? payload.data : null
  if (!data || data.length !== input.length) {
    throw new Error(
      'Embedding 返回条数不匹配（期望 ' + input.length + '，实际 ' + (data?.length ?? 0) + '）'
    )
  }

  const ordered = [...data].sort(
    (a: any, b: any) => Number(a?.index ?? 0) - Number(b?.index ?? 0)
  )
  const vectors: Float32Array[] = []
  let dimensions = 0
  for (const item of ordered) {
    const raw = item?.embedding
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('Embedding 返回了空向量')
    }
    const vector = new Float32Array(raw.map((value: unknown) => Number(value) || 0))
    if (dimensions === 0) dimensions = vector.length
    else if (vector.length !== dimensions) {
      throw new Error('Embedding 返回的向量维度不一致')
    }
    vectors.push(vector)
  }
  return { vectors, model: String(payload?.model || settings.model), dimensions }
}
