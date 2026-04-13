// agent状态机

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

export type Message =
  | UserMessage
  | AssistantMessage
  | SystemMessage
  | ToolCallMessage
  | ToolResultMessage

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
 * 工具调用消息
 *
 * LLM 决定调用某个工具时产生，记录工具名和参数
 */
export type ToolCallMessage = {
  readonly type: 'tool_call'
  readonly id: string
  readonly toolCallId: string
  readonly toolName: string
  readonly args: Record<string, unknown>
  readonly timestamp: number
}

/**
 * 工具结果消息
 *
 * 工具执行完成后产生，记录执行结果
 */
export type ToolResultMessage = {
  readonly type: 'tool_result'
  readonly id: string
  readonly toolCallId: string
  readonly toolName: string
  readonly result: unknown
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

export const createToolCallMessage = (
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): ToolCallMessage => ({
  type: 'tool_call',
  id: crypto.randomUUID(),
  toolCallId,
  toolName,
  args,
  timestamp: Date.now(),
})

export const createToolResultMessage = (
  toolCallId: string,
  toolName: string,
  result: unknown,
): ToolResultMessage => ({
  type: 'tool_result',
  id: crypto.randomUUID(),
  toolCallId,
  toolName,
  result,
  timestamp: Date.now(),
})
