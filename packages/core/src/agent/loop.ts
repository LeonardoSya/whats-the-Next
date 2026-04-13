import { stepCountIs, streamText } from 'ai'

import { createMiniMaxModel } from '../llm/client'
import type { ToolDefinition } from '../tools/types'
import { toSDKTools } from '../tools/types'
import type { AgentConfig } from '../types/config'
import type { AgentEvent } from '../types/event'
import { createAssistantMessage, type Message } from '../types/message'
import { createStreamContext, streamHandlers } from './stream-handlers'
import { toSDKMessages } from './utils'

/**
 * core Agent Loop
 *
 * 支持 tool calling 的多步对话循环。
 * AI SDK 的 stopWhen(stepCountIs) 负责 tool call → tool result → 再次请求 LLM 的自动循环。
 * 本函数通过 fullStream 捕获所有中间事件，经 streamHandlers 映射后 yield 给上层。
 *
 * @param config - Agent 配置
 * @param messages - 当前对话的消息历史
 * @param tools - 可用工具列表
 * @yields AgentEvent 事件流
 */
export async function* runAgent(
  config: AgentConfig,
  messages: readonly Message[],
  tools: readonly ToolDefinition[] = [],
): AsyncGenerator<AgentEvent> {
  const model = createMiniMaxModel(config)
  const sdkTools = tools.length > 0 ? toSDKTools(tools) : undefined

  yield { type: 'state_change', state: 'thinking' }

  try {
    const res = streamText({
      model,
      messages: config.systemPrompt
        ? [{ role: 'system' as const, content: config.systemPrompt }, ...toSDKMessages(messages)]
        : toSDKMessages(messages),
      tools: sdkTools,
      stopWhen: stepCountIs(10),
      maxOutputTokens: config.maxTokens ?? 4096,
    })

    const ctx = createStreamContext()

    for await (const part of res.fullStream) {
      const handler = streamHandlers[part.type]
      if (handler) {
        for (const event of handler(part as never, ctx)) {
          yield event
        }
      }
    }

    yield { type: 'message_complete', message: createAssistantMessage(ctx.fullText) }
    yield { type: 'state_change', state: 'done' }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    yield { type: 'error', error: errorMessage }
    yield { type: 'state_change', state: 'error' }
  }
}
