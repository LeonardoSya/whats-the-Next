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
export type AgentEvent = StateChangeEvent | TextDeltaEvent | MessageCompleteEvent | ErrorEvent

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
