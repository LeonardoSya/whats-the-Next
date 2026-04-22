// MCP 配置 + 运行时连接状态的类型

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
  Prompt,
  Resource,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'

// ── 配置 (~/.the-next/mcp.json) ──

export type McpStdioServerConfig = {
  readonly type: 'stdio'
  readonly command: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
}

export type McpHttpServerConfig = {
  readonly type: 'http'
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig

// ── 运行时状态 ──

export type MCPServerConnection =
  | ConnectedMCPServer
  | FailedMCPServer
  | PendingMCPServer

// tools/resources/prompts 由 client.ts 在 list_changed 时就地重赋值,
// 消费方应当只读不写
export type ConnectedMCPServer = {
  readonly type: 'connected'
  readonly name: string
  readonly client: Client
  tools: readonly Tool[]
  resources: readonly Resource[]
  prompts: readonly Prompt[]
  readonly instructions?: string
  readonly cleanup: () => Promise<void>
}

export type FailedMCPServer = {
  readonly type: 'failed'
  readonly name: string
  readonly error: string
}

export type PendingMCPServer = {
  readonly type: 'pending'
  readonly name: string
}
