import { streamText } from 'ai'

import { createMiniMaxModel } from '../llm/client'
import type { AgentConfig } from '../types/config'
import type { AgentEvent } from '../types/event'
import { createAssistantMessage, type Message } from '../types/message'

type LoopState = {
  // 当前对话的完整消息历史
  readonly messages: readonly Message[]
  // 已完成的对话轮数
  readonly turnCount: number
}

// 自定义的Message[]转成vercel ai sdk的CoreMessage类型
const toSDKMessages = (
  messages: readonly Message[],
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> =>
  messages.map((msg) => ({
    role: msg.type === 'user' ? 'user' : msg.type === 'assistant' ? 'assistant' : 'system',
    content: msg.content,
  }))

/**
 * core Agent Loop
 *
 * 当前版本：单轮对话：think - act - observer - repeat
 *
 * ui层通过 `for await (const event of runAgent(...))` 订阅细粒度事件
 *
 * @param config - Agent 配置
 * @param messages - 当前对话的消息历史
 * @yields AgentEvent 事件流
 */
export async function* runAgent(
  config: AgentConfig,
  messages: readonly Message[],
): AsyncGenerator<AgentEvent> {
  const model = createMiniMaxModel(config)

  let state: LoopState = {
    messages,
    turnCount: 0,
  }

  yield { type: 'state_change', state: 'thinking' }

  const sdkMessages = toSDKMessages(state.messages)

  try {
    const res = streamText({
      model,
      messages: config.systemPrompt
        ? [{ role: 'system', content: config.systemPrompt }, ...sdkMessages]
        : sdkMessages,
      maxOutputTokens: config.maxTokens ?? 4096,
    })

    yield { type: 'state_change', state: 'streaming' }

    let fullText = ''

    for await (const chunk of res.textStream) {
      fullText += chunk
      yield { type: 'text_delta', delta: chunk }
    }

    const assistantMessage = createAssistantMessage(fullText)

    state = {
      ...state,
      messages: [...state.messages, assistantMessage],
      turnCount: state.turnCount + 1,
    }

    yield { type: 'message_complete', message: assistantMessage }

    // 暂时先做单轮对话，无任何工具调用
    yield { type: 'state_change', state: 'done' }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    yield { type: 'error', error: errorMessage }
    yield { type: 'state_change', state: 'error' }
  }
}
