// MCP 官方 SDK 的封装层: 唯一直接调 @modelcontextprotocol/sdk 的文件,
// 上层 (adapter / manager / server) 看到的都是自家类型。

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolResultSchema,
  ElicitRequestSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListRootsRequestSchema,
  ListToolsResultSchema,
  type Prompt,
  PromptListChangedNotificationSchema,
  ReadResourceResultSchema,
  type Resource,
  ResourceListChangedNotificationSchema,
  type Tool,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import pkg from '../../package.json'
import type {
  ConnectedMCPServer,
  McpServerConfig,
  MCPServerConnection,
} from '../types/mcp'
import { failed, safeClose, withTimeout } from './utils'

const CONNECT_TIMEOUT_MS = 30_000
const CALL_TIMEOUT_MS = 60_000

// server 主动让 client 弹窗问用户的请求
export type ElicitationRequest = {
  readonly serverName: string
  readonly message: string
  readonly requestedSchema: Record<string, unknown>
}

export type ElicitationResult = {
  readonly action: 'accept' | 'decline' | 'cancel'
  readonly content?: Record<string, unknown>
}

export type ElicitationCallback = (
  req: ElicitationRequest,
) => Promise<ElicitationResult>

export type ConnectOptions = {
  readonly onElicitation?: ElicitationCallback
}

const buildTransport = (config: McpServerConfig): Transport => {
  if (config.type === 'stdio') {
    return new StdioClientTransport({
      command: config.command,
      args: config.args?.slice() ?? [],
      env: config.env as Record<string, string> | undefined,
      stderr: 'pipe',
    })
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers },
  })
}

export const connectMcpServer = async (
  name: string,
  config: McpServerConfig,
  options?: ConnectOptions,
): Promise<MCPServerConnection> => {
  const transport = buildTransport(config)

  const client = new Client(
    { name: pkg.name, version: pkg.version },
    {
      capabilities: {
        roots: {},
        elicitation: {},
      },
    },
  )

  // 反向 RPC handler 必须在 connect 前注册 (server 握手刚结束就可能调用)
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: [{ uri: `file://${process.cwd()}`, name: 'workspace' }],
  }))

  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    if (!options?.onElicitation) {
      console.warn(
        `[mcp] [${name}] elicitation request with no handler, cancelling: ${request.params.message}`,
      )
      return { action: 'cancel' as const }
    }
    if (!('requestedSchema' in request.params)) {
      // url mode 暂不支持
      console.warn(`[mcp] [${name}] elicitation url mode not supported`)
      return { action: 'cancel' as const }
    }
    try {
      return await options.onElicitation({
        serverName: name,
        message: request.params.message,
        requestedSchema: request.params.requestedSchema as Record<string, unknown>,
      })
    } catch (err) {
      console.warn(`[mcp] elicitation handler threw for ${name}: ${err}`)
      return { action: 'cancel' as const }
    }
  })

  try {
    await withTimeout(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      `MCP server "${name}" connect timeout (${CONNECT_TIMEOUT_MS}ms)`,
    )
  } catch (err) {
    await safeClose(transport)
    return failed(name, err)
  }

  // 按 server 声明的 capabilities 拉对应列表
  const capabilities = client.getServerCapabilities() ?? {}
  let tools: readonly Tool[] = []
  let resources: readonly Resource[] = []
  let prompts: readonly Prompt[] = []

  try {
    if (capabilities.tools) {
      const result = await client.request(
        { method: 'tools/list' },
        ListToolsResultSchema,
      )
      tools = result.tools
    }
    if (capabilities.resources) {
      const result = await client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema,
      )
      resources = result.resources
    }
    if (capabilities.prompts) {
      const result = await client.request(
        { method: 'prompts/list' },
        ListPromptsResultSchema,
      )
      prompts = result.prompts
    }
  } catch (err) {
    await client.close().catch(() => {})
    return failed(name, err)
  }

  const cleanup = async () => {
    try {
      await client.close()
    } catch {}
  }

  const conn: ConnectedMCPServer = {
    type: 'connected',
    name,
    client,
    tools,
    resources,
    prompts,
    instructions: client.getInstructions() ?? undefined,
    cleanup,
  }

  // server 主动通知列表变化 → 重拉,失败时只 warn 保留旧列表
  if (capabilities.tools?.listChanged) {
    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        try {
          const result = await client.request(
            { method: 'tools/list' },
            ListToolsResultSchema,
          )
          conn.tools = result.tools
          console.log(
            `MCP: [${name}] tools list updated (${conn.tools.length} tool(s))`,
          )
        } catch (err) {
          console.warn(`[mcp] [${name}] refetch tools failed: ${err}`)
        }
      },
    )
  }
  if (capabilities.resources?.listChanged) {
    client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      async () => {
        try {
          const result = await client.request(
            { method: 'resources/list' },
            ListResourcesResultSchema,
          )
          conn.resources = result.resources
          console.log(
            `MCP: [${name}] resources list updated (${conn.resources.length} resource(s))`,
          )
        } catch (err) {
          console.warn(`[mcp] [${name}] refetch resources failed: ${err}`)
        }
      },
    )
  }
  if (capabilities.prompts?.listChanged) {
    client.setNotificationHandler(
      PromptListChangedNotificationSchema,
      async () => {
        try {
          const result = await client.request(
            { method: 'prompts/list' },
            ListPromptsResultSchema,
          )
          conn.prompts = result.prompts
          console.log(
            `MCP: [${name}] prompts list updated (${conn.prompts.length} prompt(s))`,
          )
        } catch (err) {
          console.warn(`[mcp] [${name}] refetch prompts failed: ${err}`)
        }
      },
    )
  }

  return conn
}

// signal 透传, abort 时能立刻中断 RPC
export const callMcpTool = async (
  conn: ConnectedMCPServer,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => {
  return conn.client.request(
    { method: 'tools/call', params: { name: toolName, arguments: args } },
    CallToolResultSchema,
    { signal, timeout: CALL_TIMEOUT_MS },
  )
}

export const readMcpResource = async (
  conn: ConnectedMCPServer,
  uri: string,
  signal?: AbortSignal,
) => {
  return conn.client.request(
    { method: 'resources/read', params: { uri } },
    ReadResourceResultSchema,
    { signal, timeout: CALL_TIMEOUT_MS },
  )
}

export const getMcpPrompt = async (
  conn: ConnectedMCPServer,
  promptName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => {
  return conn.client.request(
    {
      method: 'prompts/get',
      params: { name: promptName, arguments: args },
    },
    GetPromptResultSchema,
    { signal, timeout: CALL_TIMEOUT_MS },
  )
}

export const disconnectMcpServer = async (
  conn: ConnectedMCPServer,
): Promise<void> => {
  await conn.cleanup()
}
