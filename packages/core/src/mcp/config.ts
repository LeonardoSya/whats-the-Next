import { join } from 'node:path'
import { z } from 'zod'
import { CONFIG_DIR } from '../server/config'
import type { McpServerConfig } from '../types/mcp'

const CONFIG_FILE = join(CONFIG_DIR, 'mcp.json')

const mcpStdioSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

const mcpHttpSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
})

const mcpServerSchema = z.discriminatedUnion('type', [
  mcpStdioSchema,
  mcpHttpSchema,
])

const mcpJsonSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerSchema),
})

// 读 ~/.the-next/mcp.json 配置
export const loadMcpConfig = async (): Promise<
  Readonly<Record<string, McpServerConfig>>
> => {
  const file = Bun.file(CONFIG_FILE)
  if (!(await file.exists())) return {}

  try {
    const raw = await file.json()
    const parsed = mcpJsonSchema.safeParse(raw)
    if (!parsed.success) {
      const errors = parsed.error.issues
        .map((e) => `  - ${e.path.join('.') || '(root)'}: ${e.message}`)
        .join('\n')
      console.warn(`[mcp] ${CONFIG_FILE} schema invalid:\n${errors}`)
      return {}
    }

    return parsed.data.mcpServers
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[mcp] failed to read ${CONFIG_FILE}: ${msg}`)
    return {}
  }
}
