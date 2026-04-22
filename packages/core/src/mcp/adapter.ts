// 把 MCP server 提供的工具适配成自家 ToolDefinition,让它们和内置工具走完全相同的 toSDKTools / withPermissionGate 管线

import type { ContentBlock, Tool as McpTool } from '@modelcontextprotocol/sdk/types.js'
import { jsonSchema } from 'ai'
import type { RiskLevel, ToolDefinition } from '../tools/types'
import type { ConnectedMCPServer } from '../types/mcp'
import { callMcpTool } from './client'

const MAX_TOOL_NAME = 64

const resolveRisk = (tool: McpTool): RiskLevel => {
  if (tool.annotations?.readOnlyHint) return 'safe'
  if (tool.annotations?.destructiveHint) return 'dangerous'
  return 'write'
}

// mcp__<server>__<tool>,非法字符归一成 _
export const buildMcpToolName = (serverName: string, toolName: string): string => {
  const normalize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')
  const full = `mcp__${normalize(serverName)}__${normalize(toolName)}`
  if (full.length > MAX_TOOL_NAME) {
    console.warn(`[mcp] tool name exceeds ${MAX_TOOL_NAME} chars, truncated: ${full}`)
    return full.slice(0, MAX_TOOL_NAME)
  }
  return full
}

export const mcpToToolDefinitions = (
  connections: readonly ConnectedMCPServer[],
): readonly ToolDefinition[] => {
  const defs: ToolDefinition[] = []

  for (const conn of connections) {
    for (const mcpTool of conn.tools) {
      const fullName = buildMcpToolName(conn.name, mcpTool.name)

      defs.push({
        name: fullName,
        description: mcpTool.description ?? '',
        parameters: jsonSchema(mcpTool.inputSchema as Record<string, unknown>),
        riskLevel: resolveRisk(mcpTool),
        async execute(args, options) {
          const result = await callMcpTool(
            conn,
            mcpTool.name,
            (args ?? {}) as Record<string, unknown>,
            options?.signal,
          )
          if (result.isError) {
            throw new Error(extractErrorText(result.content) ?? `${fullName} returned error`)
          }
          return normalizeMcpContent(result.content)
        },
      })
    }
  }

  return defs
}

// ContentBlock[] → 字符串 (text 透传,其它类型退化为占位符)
const normalizeMcpContent = (content: unknown): string => {
  if (!Array.isArray(content)) return ''
  return (content as ContentBlock[])
    .map((b) => {
      switch (b.type) {
        case 'text':
          return b.text
        case 'image':
          return `[image/${b.mimeType ?? '?'}, ${b.data.length} bytes base64]`
        case 'audio':
          return `[audio/${b.mimeType ?? '?'}]`
        case 'resource_link':
          return `[Resource: ${b.uri}${b.name ? ` (${b.name})` : ''}]`
        case 'resource':
          return (
            (b.resource as { text?: string; uri: string }).text ??
            `[Resource blob ${b.resource.uri}]`
          )
        default:
          return `[${(b as { type: string }).type}]`
      }
    })
    .join('\n')
}

const extractErrorText = (content: unknown): string | undefined => {
  if (!Array.isArray(content)) return undefined
  const blocks = content as ContentBlock[]
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') return b.text
  }
  return undefined
}
