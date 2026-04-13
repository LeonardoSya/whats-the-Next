/**
 * bun ws server
 */
import type { ServerWebSocket } from 'bun'
import type { AgentConfig } from '../types/config'
import { loadConfig, saveConfig } from './config'
import { jsonResponse, maskApiKey } from './utils'
import type { ClientMessage, ServerMessage } from './protocol'
import { runAgent } from '../agent/loop'

const PREFERRED_PORT = Number(process.env.PORT) || 3001
const PORT_RANGE = 10

// Map<对话id, 是否终端>
const abortFlags = new Map<string, boolean>()

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

  const agentConfig: AgentConfig = {
    model: config.model,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    systemPrompt: config.systemPrompt,
    maxTokens: config.maxTokens,
  }

  try {
    for await (const event of runAgent(agentConfig, messages.messages)) {
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
        }
      } catch {
        send(ws, { type: 'error', id: 'system', error: 'Invalid message format' })
      }
    },
    close() {
      abortFlags.clear()
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
