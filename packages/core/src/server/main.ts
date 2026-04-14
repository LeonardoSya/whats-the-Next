/**
 * bun ws server
 */
import type { ServerWebSocket } from 'bun'
import type { AgentContext } from '../agent/context'
import { runAgent } from '../agent/loop'
import type { ApprovalCallback } from '../tools/permission'
import { getDefaultTools } from '../tools/registry'
import { toSDKTools } from '../tools/types'
import type { AgentConfig } from '../types/config'
import { loadConfig, saveConfig } from './config'
import type { ClientMessage, ServerMessage } from './protocol'
import { jsonResponse, maskApiKey } from './utils'

const PREFERRED_PORT = Number(process.env.PORT) || 3001
const PORT_RANGE = 10

// Map<对话id, 是否终端>
const abortFlags = new Map<string, boolean>()

// Map<permissionId, resolve函数> — 桥接 WebSocket 异步响应与 Promise
const pendingPermissions = new Map<string, (approved: boolean) => void>()

const send = (ws: ServerWebSocket, msg: ServerMessage) => {
  ws.send(JSON.stringify(msg))
}

// REST API 路由
const handleApiRequest = async (req: Request): Promise<Response> => {
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }

  switch (url.pathname) {
    case '/api/config': {
      // 获取配置（apiKey脱敏)
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

      // 保存配置
      if (req.method === 'POST') {
        const body = (await req.json()) as AgentConfig
        await saveConfig(body)
        return jsonResponse({ ok: true })
      }

      break
    }

    // 获取完整配置（不脱敏)
    case '/api/config/full': {
      if (req.method === 'GET') {
        const config = await loadConfig()
        return jsonResponse(config)
      }
      break
    }
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

/**
 * 创建基于 WebSocket 的权限审批回调。
 * 当 dangerous 工具被调用时：
 * 1. 向前端发送 permission_request 事件
 * 2. 返回一个 Promise 等待前端的 permission_response
 */
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

  // 用户发起对话
  abortFlags.set(id, false)

  const approve = createApprovalCallback(ws, id)

  const agentContext: AgentContext = {
    config: {
      model: config.model,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      systemPrompt: config.systemPrompt,
      maxTokens: config.maxTokens,
    },
    messages: messages.messages,
    tools: toSDKTools(getDefaultTools(), approve),
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

const serverOptions = {
  fetch(req: Request, server: { upgrade(req: Request): boolean }) {
    const url = new URL(req.url)

    if (url.pathname === '/ws') {
      // 请求/ws时，将http连接升级为websocket连接，会直接走下面的websocket:{}
      if (server.upgrade(req)) return
      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(req)
    }

    return jsonResponse({ name: 'the-next', version: '0.1.0' })
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
      abortFlags.clear()
      for (const resolve of pendingPermissions.values()) {
        resolve(false)
      }
      pendingPermissions.clear()
    },
  },
}

const startServer = () => {
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
