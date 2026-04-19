/**
 * bun ws server — Chat + Task API
 */

import { join } from 'node:path'
import type { ServerWebSocket } from 'bun'
import type { AgentContext } from '../agent/context'
import { runAgent } from '../agent/loop'
import { SandboxManager, type TheNextSandboxConfig } from '../sandbox/manager'
import { executeTask } from '../task/executor'
import { deleteTaskLogs, getLogDir, readTaskLogs } from '../task/logger'
import type { TaskStatus, TaskType } from '../task/model'
import { createTask } from '../task/model'
import { logRouteDecision, routeTask, routeTaskAsync } from '../task/router'
import { TaskScheduler } from '../task/scheduler'
import { TaskStore } from '../task/store'
import { getToolkitIds, resolveToolkits } from '../task/toolkit'
import type { ApprovalCallback } from '../tools/permission'
import { getDefaultTools } from '../tools/registry'
import { toSDKTools } from '../tools/types'
import type { AgentConfig } from '../types/config'
import { CONFIG_DIR, loadConfig, saveConfig } from './config'
import type { ClientMessage, ServerMessage } from './protocol'
import { jsonResponse, maskApiKey } from './utils'

const PREFERRED_PORT = Number(process.env.PORT) || 3001
const PORT_RANGE = 10

// ── 全局状态 ──

const abortFlags = new Map<string, boolean>()
const pendingPermissions = new Map<string, (approved: boolean) => void>()
const connectedClients = new Set<ServerWebSocket>()

const taskStore = new TaskStore(join(CONFIG_DIR, 'tasks.db'))
const taskScheduler = new TaskScheduler(taskStore, runTaskInBackground)

const send = (ws: ServerWebSocket, msg: ServerMessage) => {
  ws.send(JSON.stringify(msg))
}

const broadcast = (msg: ServerMessage) => {
  const payload = JSON.stringify(msg)
  for (const ws of connectedClients) {
    ws.send(payload)
  }
}

// ── REST API ──

const handleApiRequest = async (req: Request): Promise<Response> => {
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }

  // Config endpoints (preserved)
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

  // ── Task endpoints ──

  // POST /api/tasks — 创建任务
  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const body = (await req.json()) as {
      description: string
      schedule?: { runAt?: number; cron?: string; reminder?: number }
    }
    if (!body.description) return jsonResponse({ error: 'description is required' }, 400)

    const config = await loadConfig()
    const routeMethod = config ? ('llm' as const) : ('rule' as const)
    const { taskType, title } = config
      ? await routeTaskAsync(body.description, config)
      : routeTask(body.description)
    const toolkits = resolveToolkits(taskType)

    const task = createTask({
      title,
      description: body.description,
      taskType,
      toolkitIds: getToolkitIds(toolkits),
      schedule: body.schedule,
    })

    taskStore.create(task)
    logRouteDecision(task.id, body.description, { taskType, title }, routeMethod)
    if (task.schedule) taskScheduler.schedule(task)
    broadcast({
      type: 'task_event',
      event: { type: 'task_status_changed', taskId: task.id, status: task.status },
    })
    return jsonResponse(task, 201)
  }

  // GET /api/tasks — 任务列表
  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    const status = url.searchParams.get('status') as TaskStatus | null
    const type = url.searchParams.get('type') as TaskType | null
    const tasks = taskStore.list({
      status: status ?? undefined,
      type: type ?? undefined,
    })
    return jsonResponse(tasks)
  }

  // 单任务路由: /api/tasks/:id
  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/)
  if (taskMatch?.[1]) {
    const taskId = taskMatch[1]

    // GET /api/tasks/:id
    if (req.method === 'GET') {
      const task = taskStore.getById(taskId)
      if (!task) return jsonResponse({ error: 'Task not found' }, 404)
      return jsonResponse(task)
    }

    // PATCH /api/tasks/:id
    if (req.method === 'PATCH') {
      const patch = (await req.json()) as Record<string, unknown>
      const updated = taskStore.update(taskId, patch)
      if (!updated) return jsonResponse({ error: 'Task not found' }, 404)
      broadcast({
        type: 'task_event',
        event: { type: 'task_status_changed', taskId, status: updated.status },
      })
      return jsonResponse(updated)
    }

    // DELETE /api/tasks/:id
    if (req.method === 'DELETE') {
      taskStore.delete(taskId)
      deleteTaskLogs(taskId)
      return jsonResponse({ ok: true })
    }
  }

  // GET /api/tasks/:id/messages — 任务的对话历史
  const messagesMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/messages$/)
  if (messagesMatch?.[1] && req.method === 'GET') {
    const taskId = messagesMatch[1]
    const messages = taskStore.getMessages(taskId)
    return jsonResponse(messages)
  }

  // POST /api/tasks/:id/run — 手动触发执行
  const runMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/)
  if (runMatch?.[1] && req.method === 'POST') {
    const taskId = runMatch[1]
    const task = taskStore.getById(taskId)
    if (!task) return jsonResponse({ error: 'Task not found' }, 404)
    if (task.status === 'running') return jsonResponse({ error: 'Task already running' }, 409)

    runTaskInBackground(taskId)
    return jsonResponse({ ok: true, taskId })
  }

  // GET /api/tasks/:id/logs — 任务的 workflow 日志
  const logsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/logs$/)
  if (logsMatch?.[1] && req.method === 'GET') {
    const taskId = logsMatch[1]
    const level = url.searchParams.get('level') as import('../task/logger').LogLevel | null
    const phase = url.searchParams.get('phase') as import('../task/logger').LogPhase | null
    const limit = url.searchParams.get('limit')
    const offset = url.searchParams.get('offset')
    const result = await readTaskLogs(taskId, {
      level: level ?? undefined,
      phase: phase ?? undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
    return jsonResponse(result)
  }

  // GET /api/logs/dir — 日志目录路径（调试用）
  if (url.pathname === '/api/logs/dir' && req.method === 'GET') {
    return jsonResponse({ dir: getLogDir() })
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

// ── Task 后台执行 ──

async function runTaskInBackground(taskId: string): Promise<void> {
  const task = taskStore.getById(taskId)
  if (!task) return

  const config = await loadConfig()
  if (!config) {
    taskStore.update(taskId, {
      status: 'failed',
      result: { summary: '', error: '请先配置模型 API' },
    })
    return
  }

  try {
    for await (const event of executeTask(task, config, taskStore)) {
      broadcast({ type: 'task_event', event })
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    taskStore.update(taskId, { status: 'failed', result: { summary: '', error: msg } })
    broadcast({
      type: 'task_event',
      event: { type: 'task_status_changed', taskId, status: 'failed' },
    })
  }
}

// ── Chat（保留原有 chatbot 功能）──

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

    return jsonResponse({ name: 'the-next', version: '0.2.0' })
  },

  websocket: {
    open(ws: ServerWebSocket) {
      connectedClients.add(ws)
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
          case 'task_run':
            runTaskInBackground(msg.taskId)
            break
        }
      } catch {
        send(ws, { type: 'error', id: 'system', error: 'Invalid message format' })
      }
    },
    close(ws: ServerWebSocket) {
      connectedClients.delete(ws)
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
      console.log(`Task DB: ${join(CONFIG_DIR, 'tasks.db')}`)

      await taskScheduler.init()
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
