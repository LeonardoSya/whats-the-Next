import type { AgentEvent, Message } from '..'

// 请求（前端 → Server）
export type ClientMessage = ChatRequest | AbortRequest

export type ChatRequest = {
  readonly type: 'chat'
  readonly id: string
  readonly messages: readonly Message[]
}

export type AbortRequest = {
  readonly type: 'abort'
  readonly id: string
}

// 响应（Server → 前端)
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
