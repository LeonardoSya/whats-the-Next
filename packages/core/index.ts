// @the-next/core - 这里对外暴露公共api

// agent核心循环
export { runAgent } from './src/agent/loop'

// llm客户端
export { createMiniMaxModel } from './src/llm/client'

export type { AgentConfig } from './src/types/config'

// agent事件类型
export type {
  AgentEvent,
  ErrorEvent,
  MessageCompleteEvent,
  StateChangeEvent,
  TextDeltaEvent,
} from './src/types/event'

// 消息类型
export type {
  AgentState,
  AssistantMessage,
  Message,
  SystemMessage,
  UserMessage,
} from './src/types/message'

// 创建消息
export {
  createAssistantMessage,
  createSystemMessage,
  createUserMessage,
} from './src/types/message.js'
