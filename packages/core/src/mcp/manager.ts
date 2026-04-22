// MCP 生命周期单例: 启动连接、给 server 拼工具列表、关进程清理

import type { ToolDefinition } from '../tools/types'
import type { ConnectedMCPServer, MCPServerConnection } from '../types/mcp'
import { mcpToToolDefinitions } from './adapter'
import {
  type ConnectOptions,
  connectMcpServer,
  disconnectMcpServer,
} from './client'
import { loadMcpConfig } from './config'
import { buildMcpMetaTools } from './metaTools'

class McpManagerImpl {
  private connections: MCPServerConnection[] = []
  private initialized = false

  async init(options?: ConnectOptions): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    const servers = await loadMcpConfig()
    const entries = Object.entries(servers)

    if (entries.length === 0) {
      console.log('MCP: no servers configured')
      return
    }

    console.log(`MCP: connecting to ${entries.length} server(s)...`)
    this.connections = await Promise.all(
      entries.map(([name, cfg]) => connectMcpServer(name, cfg, options)),
    )

    for (const c of this.connections) {
      if (c.type === 'connected') {
        const parts = [
          `${c.tools.length} tool(s)`,
          c.resources.length > 0 ? `${c.resources.length} resource(s)` : null,
          c.prompts.length > 0 ? `${c.prompts.length} prompt(s)` : null,
        ].filter(Boolean)
        console.log(`MCP: [${c.name}] connected — ${parts.join(', ')}`)
      } else if (c.type === 'failed') {
        console.warn(`MCP: [${c.name}] FAILED — ${c.error}`)
      }
    }
  }

  // 各 server 提供的具体工具 + 跨 server 操作 resources/prompts 的 meta tool
  getToolDefinitions(): readonly ToolDefinition[] {
    const connected = this.getConnected()
    return [...mcpToToolDefinitions(connected), ...buildMcpMetaTools(connected)]
  }

  // server 自带的"使用说明",拼进 systemPrompt 让 LLM 用 server 更准确
  getInstructionsForSystemPrompt(): string | undefined {
    const blocks = this.getConnected()
      .filter((c) => c.instructions)
      .map((c) => `### MCP server: ${c.name}\n${c.instructions}`)
    if (blocks.length === 0) return undefined
    return `## MCP servers\n\n${blocks.join('\n\n')}`
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.getConnected().map(disconnectMcpServer))
    this.connections = []
    this.initialized = false
  }

  private getConnected(): readonly ConnectedMCPServer[] {
    return this.connections.filter(
      (c): c is ConnectedMCPServer => c.type === 'connected',
    )
  }
}

export const McpManager = new McpManagerImpl()
