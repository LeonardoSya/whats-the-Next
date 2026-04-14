import { stepCountIs, streamText } from 'ai'

import { createMiniMaxModel } from '../llm/client'
import type { AgentEvent } from '../types/event'
import { createAssistantMessage } from '../types/message'
import type { AgentContext } from './context'
import { createStreamContext, streamHandlers } from './stream-handlers'
import { toSDKMessages } from './utils'

/**
 * core Agent Loop
 *
 * 支持 tool calling 的多步对话循环。
 * AI SDK 的 stopWhen(stepCountIs) 负责 tool call → tool result → 再次请求 LLM 的自动循环。
 * 本函数通过 fullStream 捕获所有中间事件，经 streamHandlers 映射后 yield 给上层。
 */
export async function* runAgent(ctx: AgentContext): AsyncGenerator<AgentEvent> {
  const { config, messages, tools } = ctx
  const model = createMiniMaxModel(config)

  yield { type: 'state_change', state: 'thinking' }

  try {
    const res = streamText({
      model,
      messages: config.systemPrompt
        ? [{ role: 'system' as const, content: config.systemPrompt }, ...toSDKMessages(messages)]
        : toSDKMessages(messages),
      tools,
      stopWhen: stepCountIs(10),
      maxOutputTokens: config.maxTokens ?? 4096,
    })

    const streamCtx = createStreamContext()

    for await (const part of res.fullStream) {
      const handler = streamHandlers[part.type]
      if (handler) {
        for (const event of handler(part as never, streamCtx)) {
          yield event
        }
      }
    }

    yield { type: 'message_complete', message: createAssistantMessage(streamCtx.fullText) }
    yield { type: 'state_change', state: 'done' }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    yield { type: 'error', error: errorMessage }
    yield { type: 'state_change', state: 'error' }
  }
}
