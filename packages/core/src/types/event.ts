// agent事件

import type { AgentState, AssistantMessage } from './message'

/**
 * Agent 事件联合类型。
 *
 * Agent Loop（AsyncGenerator）产出的所有事件类型的联合。
 * 消费方通过 `event.type` 进行类型判别。
 *
 * @example
 * ```ts
 * for await (const event of runAgent(config, messages)) {
 *   switch (event.type) {
 *     case 'state_change':   // 更新状态指示器
 *     case 'text_delta':     // 追加流式文本
 *     case 'message_complete': // 保存完整消息
 *     case 'error':          // 显示错误
 *   }
 * }
 * ```
 */
export type AgentEvent =
  | StateChangeEvent
  | TextDeltaEvent
  | MessageCompleteEvent
  | ErrorEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolErrorEvent

/**
 * 状态变更事件。
 *
 * 当 Agent 的运行状态发生转换时产出此事件。
 * UI 层据此更新状态指示器（如"思考中"、"生成中"等）。
 */
export type StateChangeEvent = {
  readonly type: 'state_change'
  // 变更后的agent状态
  readonly state: AgentState
}

/**
 * 文本增量事件。
 *
 * LLM 每产出一个 token chunk 就会触发此事件。
 * UI 层据此实现打字机效果的流式显示。
 */
export type TextDeltaEvent = {
  readonly type: 'text_delta'
  // 本次增量文本片段
  readonly delta: string
}

/**
 * 消息完成事件。
 *
 * 当 LLM 的一轮完整输出结束后产出此事件，
 * 携带封装好的 AssistantMessage 对象。
 */
export type MessageCompleteEvent = {
  readonly type: 'message_complete'
  readonly message: AssistantMessage
}

export type ErrorEvent = {
  readonly type: 'error'
  readonly error: string
}

/**
 * 工具调用事件。
 *
 * LLM 决定调用工具时产出，携带工具名和参数。
 * UI 层据此显示"正在调用 xxx 工具"的状态。
 */
export type ToolCallEvent = {
  readonly type: 'tool_call'
  readonly toolCallId: string
  readonly toolName: string
  readonly args: Record<string, unknown>
}

/**
 * 工具结果事件。
 *
 * 工具执行完成后产出，携带执行结果。
 * UI 层据此展示工具返回数据。
 */
export type ToolResultEvent = {
  readonly type: 'tool_result'
  readonly toolCallId: string
  readonly toolName: string
  readonly result: unknown
}

/**
 * 工具执行错误事件。
 *
 * 工具的 execute 函数抛出异常时产出。
 * UI 层据此在对应的工具卡片上展示错误信息。
 */
export type ToolErrorEvent = {
  readonly type: 'tool_error'
  readonly toolCallId: string
  readonly toolName: string
  readonly error: string
}
