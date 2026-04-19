// agent事件

import type { RiskLevel } from '../tools/types'
import type { AgentState, AssistantMessage } from './message'

/**
 * Agent 事件联合类型。
 */
export type AgentEvent =
  // agent 子状态切换:thinking → streaming → tool_calling → done/error
  | StateChangeEvent

  // llm 流式输出文本中（用来模拟打字机效果）
  | TextDeltaEvent
  
  // llm 一段文本输出完毕
  | MessageCompleteEvent

  // loop 发生不可恢复错误(LLM 调用失败 / 流消费异常等)
  | ErrorEvent

  // llm 决定调用 tool
  | ToolCallEvent

  // tool execute success, 携带返回结果
  | ToolResultEvent

  // tool execute error, 携带错误信息(loop 不会因此终止)
  | ToolErrorEvent

  // dangerous 级别工具执行前, 需用户手动审批请求, 等待前端 permission_response
  | PermissionRequestEvent

  // 一轮 turn 完成, 携带本轮统计 + 状态机的 transition
  | TurnCompleteEvent

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

/**
 * 权限请求事件。
 *
 * 工具执行前如果需要用户确认（dangerous 级别），
 * 产出此事件暂停执行，等待前端回复 permission_response。
 */
export type PermissionRequestEvent = {
  readonly type: 'permission_request'
  readonly permissionId: string
  readonly toolName: string
  readonly args: Record<string, unknown>
  readonly riskLevel: RiskLevel
}

/**
 * Turn 完成事件
 */
export type TurnCompleteEvent = {
  readonly type: 'turn_complete'
  readonly turnCount: number
  readonly toolCallCount: number
  readonly inputTokens: number
  readonly outputTokens: number
  // 本轮 LLM 输出的完整文本(可能为空字符串, 比如 LLM 直接调工具不说话的情况)
  readonly assistantText: string
  readonly durationMs: number
  readonly transition: 'next_turn' | 'done' | 'aborted' | 'error'
}
