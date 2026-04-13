// @the-next/core - 这里对外暴露公共api

// agent核心循环
export { runAgent } from './agent/loop'

// llm客户端
export { createMiniMaxModel } from './llm/client'

export type { AgentConfig } from './types/config'

// agent事件类型
export type {
  AgentEvent,
  ErrorEvent,
  MessageCompleteEvent,
  StateChangeEvent,
  TextDeltaEvent,
  ToolCallEvent,
  ToolErrorEvent,
  ToolResultEvent,
} from './types/event'

// 消息类型
export type {
  AgentState,
  AssistantMessage,
  Message,
  SystemMessage,
  ToolCallMessage,
  ToolResultMessage,
  UserMessage,
} from './types/message'

// 创建消息
export {
  createAssistantMessage,
  createSystemMessage,
  createToolCallMessage,
  createToolResultMessage,
  createUserMessage,
} from './types/message.js'

// 工具系统
export type { ToolDefinition } from './tools/types'
export { toSDKTools } from './tools/types'
export { getDefaultTools } from './tools/registry'
