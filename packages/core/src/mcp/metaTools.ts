// 4 个 meta tool: 把 MCP 的 resources / prompts 能力暴露给 LLM 调用。
// 只在至少有一个 server 实际暴露对应能力时才注册,避免污染工具列表。

import { z } from 'zod'
import type { ToolDefinition } from '../tools/types'
import type { ConnectedMCPServer } from '../types/mcp'
import { getMcpPrompt, readMcpResource } from './client'

const findServer = (
  connections: readonly ConnectedMCPServer[],
  name: string,
): ConnectedMCPServer => {
  const conn = connections.find((c) => c.name === name)
  if (!conn) {
    throw new Error(`MCP server "${name}" not found or not connected`)
  }
  return conn
}

// PromptMessage[] → 给 LLM 看的可读文本
const promptMessagesToText = (
  messages: readonly { role: string; content: unknown }[],
): string =>
  messages
    .map((m) => `[${m.role}]\n${extractMessageText(m.content)}`)
    .join('\n\n')

const extractMessageText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'object' && b && 'type' in b) {
          const block = b as { type: string; text?: string }
          if (block.type === 'text' && typeof block.text === 'string') {
            return block.text
          }
          return `[${block.type}]`
        }
        return ''
      })
      .join('\n')
  }
  if (
    typeof content === 'object' &&
    content !== null &&
    'type' in content &&
    (content as { type: string }).type === 'text'
  ) {
    return String((content as unknown as { text: string }).text)
  }
  return JSON.stringify(content)
}

const listResourcesParameters = z.object({
  server: z
    .string()
    .optional()
    .describe('Limit to a specific MCP server name. Omit for all servers.'),
})

const listResourcesTool = (
  connections: readonly ConnectedMCPServer[],
): ToolDefinition<typeof listResourcesParameters> => ({
  name: 'mcp_list_resources',
  description:
    'List resources exposed by connected MCP servers. Resources are read-only data sources (files, API endpoints, datasets) that MCP servers expose with stable URIs. Use mcp_read_resource to read one. Optionally filter by server name.',
  parameters: listResourcesParameters,
  riskLevel: 'safe',
  async execute({ server }) {
    const filtered = server
      ? connections.filter((c) => c.name === server)
      : connections
    const items = filtered.flatMap((c) =>
      c.resources.map((r) => ({
        server: c.name,
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    )
    return { count: items.length, resources: items }
  },
})

const readResourceParameters = z.object({
  uri: z
    .string()
    .describe(
      'The resource URI (e.g. "file:///path" or a server-specific scheme).',
    ),
})

const readResourceTool = (
  connections: readonly ConnectedMCPServer[],
): ToolDefinition<typeof readResourceParameters> => ({
  name: 'mcp_read_resource',
  description:
    'Read the contents of an MCP resource by URI. The URI must come from a prior mcp_list_resources call. Returns text contents inline; binary contents are described but not embedded.',
  parameters: readResourceParameters,
  riskLevel: 'safe',
  async execute({ uri }, options) {
    const owner = connections.find((c) =>
      c.resources.some((r) => r.uri === uri),
    )
    if (!owner) {
      throw new Error(
        `No MCP server exposes resource ${uri}. Use mcp_list_resources first.`,
      )
    }
    const result = await readMcpResource(owner, uri, options?.signal)
    return {
      uri,
      server: owner.name,
      contents: result.contents.map((c) => {
        if (typeof (c as { text?: unknown }).text === 'string') {
          return {
            type: 'text' as const,
            mimeType: c.mimeType,
            text: (c as { text: string }).text,
          }
        }
        if (typeof (c as { blob?: unknown }).blob === 'string') {
          return {
            type: 'blob' as const,
            mimeType: c.mimeType,
            sizeBase64: (c as { blob: string }).blob.length,
          }
        }
        return { type: 'unknown' as const }
      }),
    }
  },
})

const listPromptsParameters = z.object({
  server: z
    .string()
    .optional()
    .describe('Limit to a specific MCP server name.'),
})

const listPromptsTool = (
  connections: readonly ConnectedMCPServer[],
): ToolDefinition<typeof listPromptsParameters> => ({
  name: 'mcp_list_prompts',
  description:
    'List prompt templates exposed by connected MCP servers. A prompt is a parameterized template that produces a sequence of messages. Use mcp_get_prompt to render one.',
  parameters: listPromptsParameters,
  riskLevel: 'safe',
  async execute({ server }) {
    const filtered = server
      ? connections.filter((c) => c.name === server)
      : connections
    const items = filtered.flatMap((c) =>
      c.prompts.map((p) => ({
        server: c.name,
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      })),
    )
    return { count: items.length, prompts: items }
  },
})

const getPromptParameters = z.object({
  server: z.string().describe('The MCP server name (from mcp_list_prompts).'),
  name: z.string().describe('The prompt template name.'),
  arguments: z
    .record(z.string(), z.string())
    .optional()
    .describe('Argument values keyed by argument name (all values stringified).'),
})

const getPromptTool = (
  connections: readonly ConnectedMCPServer[],
): ToolDefinition<typeof getPromptParameters> => ({
  name: 'mcp_get_prompt',
  description:
    'Render an MCP prompt template with the given arguments. Returns the rendered messages as text. Use this to apply a server-provided template to your context.',
  parameters: getPromptParameters,
  riskLevel: 'safe',
  async execute({ server, name, arguments: args }, options) {
    const conn = findServer(connections, server)
    const result = await getMcpPrompt(conn, name, args ?? {}, options?.signal)
    return {
      server,
      prompt: name,
      description: result.description,
      text: promptMessagesToText(result.messages),
    }
  },
})

export const buildMcpMetaTools = (
  connections: readonly ConnectedMCPServer[],
): readonly ToolDefinition[] => {
  const hasResources = connections.some((c) => c.resources.length > 0)
  const hasPrompts = connections.some((c) => c.prompts.length > 0)

  const tools: ToolDefinition[] = []
  if (hasResources) {
    tools.push(listResourcesTool(connections), readResourceTool(connections))
  }
  if (hasPrompts) {
    tools.push(listPromptsTool(connections), getPromptTool(connections))
  }
  return tools
}
