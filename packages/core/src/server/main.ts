/**
 * bun ws server — 单轮对话 Agent 桥接前端。
 *
 * 唯一职责:把 runAgent 的 AgentEvent 流通过 WebSocket 喂给前端。
 * 不做持久化、不做调度、不区分会话。前端关闭即结束。
 */

import type { ServerWebSocket } from 'bun'
import { runAgent } from '../agent/loop'
import { SandboxManager, type TheNextSandboxConfig } from '../sandbox/manager'
import type { ApprovalCallback } from '../tools/permission'
import { getDefaultTools } from '../tools/registry'
import { toSDKTools } from '../tools/types'
import type { AgentConfig } from '../types/config'
import type { AgentContext } from '../types/context'
import { loadConfig, saveConfig } from './config'
import type { ClientMessage, ServerMessage } from './protocol'
import { jsonResponse, maskApiKey } from './utils'

const PREFERRED_PORT = Number(process.env.PORT) || 3001
const PORT_RANGE = 10

// ── 全局状态 ──
// 多 WS 并发时,每条 chat 用 id 区分,abortFlags / pendingPermissions 都按 id 索引

const abortFlags = new Map<string, boolean>()
const pendingPermissions = new Map<string, (approved: boolean) => void>()

const send = (ws: ServerWebSocket, msg: ServerMessage) => {
  ws.send(JSON.stringify(msg))
}

// ── REST API ──

const handleApiRequest = async (req: Request): Promise<Response> => {
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }

  if (url.pathname === '/api/config') {
    if (req.method === 'GET') {
      const config = await loadConfig()
      if (!config) return jsonResponse({ configured: false })
      return jsonResponse({
        configured: true,
        model: config.model,
        apiKey: maskApiKey(config.apiKey),
        baseURL: config.baseURL,
        systemPrompt: config.systemPrompt,
        maxTokens: config.maxTokens,
      } as AgentConfig & { configured: boolean })
    }
    if (req.method === 'POST') {
      const body = (await req.json()) as AgentConfig
      await saveConfig(body)
      return jsonResponse({ ok: true })
    }
  }

  if (url.pathname === '/api/config/full') {
    if (req.method === 'GET') {
      const config = await loadConfig()
      return jsonResponse(config)
    }
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

// ── Chat 处理 ──

const createApprovalCallback = (ws: ServerWebSocket, chatId: string): ApprovalCallback => {
  return (request) => {
    send(ws, {
      type: 'event',
      id: chatId,
      event: {
        type: 'permission_request',
        permissionId: request.permissionId,
        toolName: request.toolName,
        args: request.args,
        riskLevel: request.riskLevel,
      },
    })
    return new Promise<boolean>((resolve) => {
      pendingPermissions.set(request.permissionId, resolve)
    })
  }
}

const handleChat = async (
  ws: ServerWebSocket,
  id: string,
  messages: ClientMessage & { type: 'chat' },
) => {
  const config = await loadConfig()
  if (!config) {
    send(ws, { type: 'error', id, error: '请先配置模型API' })
    return
  }

  abortFlags.set(id, false)
  const approve = createApprovalCallback(ws, id)
  const tools = getDefaultTools()

  const agentContext: AgentContext = {
    config: {
      model: config.model,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      systemPrompt: config.systemPrompt,
      maxTokens: config.maxTokens,
    },
    messages: messages.messages,
    tools: toSDKTools(tools, approve),
  }

  try {
    for await (const event of runAgent(agentContext)) {
      if (abortFlags.get(id)) {
        abortFlags.delete(id)
        send(ws, { type: 'event', id, event: { type: 'state_change', state: 'idle' } })
        return
      }
      send(ws, { type: 'event', id, event })
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    send(ws, { type: 'error', id, error: msg })
  } finally {
    abortFlags.delete(id)
  }
}

// ── Bun.serve ──

const serverOptions = {
  fetch(req: Request, server: { upgrade(req: Request): boolean }) {
    const url = new URL(req.url)

    if (url.pathname === '/ws') {
      if (server.upgrade(req)) return
      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(req)
    }

    return jsonResponse({ name: 'the-next', version: '0.3.0' })
  },

  websocket: {
    open(ws: ServerWebSocket) {
      send(ws, { type: 'ready' })
    },
    message(ws: ServerWebSocket, raw: string | Buffer) {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage
        switch (msg.type) {
          case 'chat':
            handleChat(ws, msg.id, msg)
            break
          case 'abort':
            abortFlags.set(msg.id, true)
            break
          case 'permission_response': {
            const resolve = pendingPermissions.get(msg.permissionId)
            if (resolve) {
              resolve(msg.approved)
              pendingPermissions.delete(msg.permissionId)
            }
            break
          }
        }
      } catch {
        send(ws, { type: 'error', id: 'system', error: 'Invalid message format' })
      }
    },
    close() {
      // 全局清空,假设单连接场景。多连接场景下应按 ws 维度跟踪
      abortFlags.clear()
      for (const resolve of pendingPermissions.values()) {
        resolve(false)
      }
      pendingPermissions.clear()
    },
  },
}

const startServer = async () => {
  const sandboxConfig: TheNextSandboxConfig = {
    enabled: true,
    workingDirectory: process.cwd(),
  }
  const sandboxOk = await SandboxManager.init(sandboxConfig)
  if (sandboxOk) {
    console.log('Sandbox: enabled (sandbox-runtime)')
  } else {
    const reason = SandboxManager.getUnavailableReason()
    console.warn(`Sandbox: DISABLED${reason ? ` — ${reason}` : ''}`)
  }

  for (let offset = 0; offset < PORT_RANGE; offset++) {
    try {
      const port = PREFERRED_PORT + offset
      Bun.serve({ ...serverOptions, port })
      console.log(`the-next server running on http://localhost:${port}`)
      console.log(`WebSocket endpoint: ws://localhost:${port}/ws`)
      return
    } catch (e) {
      if (offset < PORT_RANGE - 1) continue
      throw new Error(
        `No available port in range ${PREFERRED_PORT}-${PREFERRED_PORT + PORT_RANGE - 1}`,
        { cause: e },
      )
    }
  }
}

startServer()
