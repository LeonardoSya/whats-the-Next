const PREFERRED_PORT = 3001
const PORT_RANGE = 10
const PROBE_TIMEOUT_MS = 800

let resolvedPort: number | null = null
let pending: Promise<number> | null = null

/**
 * 从3001开始往后找一个可用的端口（最多到3010）
 * 结果会被缓存，后续调用直接返回。
 */
export function discoverServer(): Promise<number> {
  if (resolvedPort !== null) return Promise.resolve(resolvedPort)
  if (pending) return pending

  pending = (async () => {
    const ports = Array.from({ length: PORT_RANGE }, (_, i) => PREFERRED_PORT + i)

    const port = await Promise.any(
      ports.map(async (p) => {
        const res = await fetch(`http://localhost:${p}/`, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
        const data = await res.json()
        if (data.name !== 'the-next') throw new Error('not our server')
        return p
      }),
    )

    resolvedPort = port
    return port
  })()

  pending.catch(() => {
    pending = null
  })

  return pending
}

export function getHttpBase(): string {
  if (resolvedPort === null)
    throw new Error('Server not discovered yet — call discoverServer() first')
  return `http://localhost:${resolvedPort}`
}

export function getWsUrl(): string {
  if (resolvedPort === null)
    throw new Error('Server not discovered yet — call discoverServer() first')
  return `ws://localhost:${resolvedPort}/ws`
}

/** 清除缓存，用于重连时重新探测 */
export function resetDiscovery(): void {
  resolvedPort = null
  pending = null
}
