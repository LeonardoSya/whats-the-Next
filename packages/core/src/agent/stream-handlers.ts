// 维护一份 AgentEvent 映射表
import type { AgentEvent } from '../types/event'

/**
 * stream 事件处理期间的可变上下文。
 * 在 fullStream 的整个生命周期内共享，handler 通过读写它来跨事件协调状态。
 */
export type StreamContext = {
  /** 累积所有 text-delta，最终拼成完整的 assistant message */
  fullText: string
  /** 标记当前 step 是否已经 yield 过 streaming 状态，避免重复触发 */
  hasStartedStreaming: boolean
}

export type StreamPartHandler = (part: never, ctx: StreamContext) => AgentEvent[]

export const createStreamContext = (): StreamContext => ({
  fullText: '',
  hasStartedStreaming: false,
})

/**
 * AI SDK fullStream 事件 → AgentEvent 的映射表。
 * 新增事件类型时只需在此添加一行 handler，无需修改主循环。
 */
export const streamHandlers: Record<string, StreamPartHandler> = {
  // LLM 输出文本 token，首次时切换到 streaming 状态
  'text-delta'(part: { text: string }, ctx) {
    const events: AgentEvent[] = []
    if (!ctx.hasStartedStreaming) {
      events.push({ type: 'state_change', state: 'streaming' })
      ctx.hasStartedStreaming = true
    }
    ctx.fullText += part.text
    events.push({ type: 'text_delta', delta: part.text })
    return events
  },

  // LLM 决定调用工具，携带工具名和参数
  'tool-call'(part: { toolCallId: string; toolName: string; input: unknown }, ctx) {
    ctx.hasStartedStreaming = false
    return [
      { type: 'state_change', state: 'tool_calling' },
      {
        type: 'tool_call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.input as Record<string, unknown>,
      },
    ]
  },

  // 工具执行完毕，结果回传，切回 thinking 等待下一步
  'tool-result'(part: { toolCallId: string; toolName: string; output: unknown }) {
    return [
      {
        type: 'tool_result',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: part.output,
      },
      { type: 'state_change', state: 'thinking' },
    ]
  },

  // 工具执行出错
  'tool-error'(part: { toolCallId: string; toolName: string; error: unknown }) {
    const message = part.error instanceof Error ? part.error.message : String(part.error)
    return [
      {
        type: 'tool_error',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        error: message,
      },
      { type: 'state_change', state: 'thinking' },
    ]
  },

  // 新一轮 step 开始，重置 streaming 标记
  'start-step'(_part: unknown, ctx) {
    ctx.hasStartedStreaming = false
    return []
  },
}
