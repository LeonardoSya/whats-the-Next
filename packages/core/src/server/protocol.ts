import type { TaskEvent } from '../task/model'
import type { AgentEvent } from '../types/event'
import type { Message } from '../types/message'

// ── 请求（前端 → Server）──

export type ClientMessage = ChatRequest | AbortRequest | PermissionResponse | TaskRunRequest

export type ChatRequest = {
  readonly type: 'chat'
  readonly id: string
  readonly messages: readonly Message[]
}

export type AbortRequest = {
  readonly type: 'abort'
  readonly id: string
}

export type TaskRunRequest = {
  readonly type: 'task_run'
  readonly taskId: string
}

// ── 响应（Server → 前端）──

export type ServerMessage = EventMessage | ReadyMessage | ErrorMessage | TaskEventMessage

export type EventMessage = {
  readonly type: 'event'
  readonly id: string
  readonly event: AgentEvent
}

export type TaskEventMessage = {
  readonly type: 'task_event'
  readonly event: TaskEvent
}

export type ReadyMessage = {
  readonly type: 'ready'
}

export type ErrorMessage = {
  readonly type: 'error'
  readonly id: string
  readonly error: string
}

// 权限请求的响应
export type PermissionResponse = {
  readonly type: 'permission_response'
  readonly permissionId: string
  readonly approved: boolean
}
