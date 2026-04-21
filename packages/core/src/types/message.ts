// agent状态机 + 对话消息类型

import type { ModelMessage } from 'ai'

/**
 * agent运行时状态
 *
 * * 状态流转：idle → thinking → streaming → done
 *
 * - `idle`：空闲，等待用户输入
 * - `thinking`：正在向 LLM 发送请求，等待首个 token
 * - `streaming`：正在接收 LLM 的流式输出
 * - `tool_calling`：正在执行工具调用
 * - `error`：发生错误
 * - `done`：本轮对话完成
 */
export type AgentState = 'idle' | 'thinking' | 'streaming' | 'tool_calling' | 'error' | 'done'

/**
 * 对话消息类型(自家协议,跟前端 UI 一起使用)。
 *
 * 只含三种"用户可感知"的消息:user / assistant / system。
 * 工具调用/结果属于 LLM 内部产物,走 AgentEvent 流(ToolCallEvent / ToolResultEvent)
 * 实时推给前端,不落在 Message 数组里。
 *
 * 跟 AI SDK 的 ModelMessage 的关系:
 * - Message 带 id(React key) + timestamp(排序),方便 UI
 * - ModelMessage 是 SDK 协议,content 可为 TextPart[]/ToolCallPart[]/ToolResultPart[]
 * - 边界转换见 toModelMessages()
 */
export type Message = UserMessage | AssistantMessage | SystemMessage

/**
 * 用户消息
 */
export type UserMessage = {
  readonly type: 'user'
  readonly id: string
  readonly content: string
  readonly timestamp: number
}

/**
 * ai消息
 *
 * agent loop在流式输出完成后创建
 */
export type AssistantMessage = {
  readonly type: 'assistant'
  readonly id: string
  readonly content: string
  readonly timestamp: number
}

/**
 * 系统消息
 *
 * 用于注入系统级指令，通常不会展示给用户
 */
export type SystemMessage = {
  readonly type: 'system'
  readonly id: string
  readonly content: string
  readonly timestamp: number
}

/**
 * 创建用户消息
 */
export const createUserMessage = (content: string): UserMessage => ({
  type: 'user',
  id: crypto.randomUUID(),
  content,
  timestamp: Date.now(),
})

/**
 * 创建助手消息
 *
 * 将完整的流式输出封装为消息
 */
export const createAssistantMessage = (content: string): AssistantMessage => ({
  type: 'assistant',
  id: crypto.randomUUID(),
  content,
  timestamp: Date.now(),
})

/**
 * 创建系统消息
 */
export const createSystemMessage = (content: string): SystemMessage => ({
  type: 'system',
  id: crypto.randomUUID(),
  content,
  timestamp: Date.now(),
})

export const toModelMessages = (messages: readonly Message[]): ModelMessage[] =>
  messages.map((m) => ({ role: m.type, content: m.content }))
