function parseVersion(version: string): { core: number[]; pre: string[] } {
  const cleaned = version.trim().replace(/^v/i, '').split('+')[0]
  const dash = cleaned.indexOf('-')
  const coreText = dash >= 0 ? cleaned.slice(0, dash) : cleaned
  const preText = dash >= 0 ? cleaned.slice(dash + 1) : ''
  return {
    core: coreText.split('.').map((part) => {
      const value = Number(part)
      return Number.isFinite(value) ? value : 0
    }),
    pre: preText ? preText.split('.') : []
  }
}

/** 语义化版本比较：v 前缀、alpha/beta/rc 等预发布标识均支持。 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  const length = Math.max(a.core.length, b.core.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (diff !== 0) return diff
  }

  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1

  const preLength = Math.max(a.pre.length, b.pre.length)
  for (let index = 0; index < preLength; index += 1) {
    const leftPart = a.pre[index]
    const rightPart = b.pre[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) {
      const diff = Number(leftPart) - Number(rightPart)
      if (diff !== 0) return diff
    } else if (leftNumeric) {
      return -1
    } else if (rightNumeric) {
      return 1
    } else if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1
    }
  }
  return 0
}
