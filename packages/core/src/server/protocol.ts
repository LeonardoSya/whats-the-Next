// WebSocket 协议: 前端 ↔ server 的消息类型定义

import type { AgentEvent } from '../types/event'
import type { Message } from '../types/message'

// ── 前端 → Server ──

export type ClientMessage = ChatRequest | AbortRequest | PermissionResponse

export type ChatRequest = {
  readonly type: 'chat'
  readonly id: string
  readonly messages: readonly Message[]
}

export type AbortRequest = {
  readonly type: 'abort'
  readonly id: string
}

export type PermissionResponse = {
  readonly type: 'permission_response'
  readonly permissionId: string
  readonly approved: boolean
}

// ── Server → 前端 ──

export type ServerMessage = EventMessage | ReadyMessage | ErrorMessage

export type EventMessage = {
  readonly type: 'event'
  readonly id: string
  readonly event: AgentEvent
}

export type ReadyMessage = {
  readonly type: 'ready'
}

export type ErrorMessage = {
  readonly type: 'error'
  readonly id: string
  readonly error: string
}
