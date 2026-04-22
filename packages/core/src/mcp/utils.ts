import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { FailedMCPServer } from '../types/mcp'

export const withTimeout = <T>(
  p: Promise<T>,
  ms: number,
  msg: string,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })

export const failed = (name: string, err: unknown): FailedMCPServer => ({
  type: 'failed',
  name,
  error: err instanceof Error ? err.message : String(err),
})

// best-effort 关闭, 出错吞掉
export const safeClose = async (transport: Transport): Promise<void> => {
  try {
    await transport.close()
  } catch {}
}
