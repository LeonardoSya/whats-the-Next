import { type ModelMessage, stepCountIs, streamText } from 'ai'

import { createMiniMaxModel } from '../llm/client'
import type { AgentEvent } from '../types/event'
import { createAssistantMessage } from '../types/message'
import type { AgentContext } from './context'
import type { AgentLoopState, Transition } from './state'

const MAX_TURNS = 10

const EMPTY_TURN_METRICS = {
  toolCallCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  assistantText: '',
  durationMs: 0,
} as const

/**
 * Agent Loop
 *
 * 1. 一次 while 迭代 = 一次 LLM 调用 + SDK 同步执行的所有 tool_call
 *
 * 2. 跨越多轮迭代的状态由 AgentLoopState 持有
 */
export async function* runAgent(ctx: AgentContext): AsyncGenerator<AgentEvent> {
  const { messages, abort, config } = ctx

  // 初始化状态机:把外部 Message 投影成 SDK 的 ModelMessage
  let state: AgentLoopState = {
    messages: messages.flatMap((m): ModelMessage[] => {
      if (m.type === 'user') return [{ role: 'user', content: m.content }]
      if (m.type === 'assistant') return [{ role: 'assistant', content: m.content }]
      if (m.type === 'system') return [{ role: 'system', content: m.content }]
      return []
    }),
    turnCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    transition: undefined,
  }

  // loop start
  yield { type: 'state_change', state: 'thinking' }

  while (true) {
    if (abort?.signal.aborted) {
      yield { type: 'state_change', state: 'idle' }
      return
    }

    if (state.turnCount >= MAX_TURNS) {
      const transition: Transition = { kind: 'done', reason: 'max_turns' }
      state = { ...state, transition }

      yield {
        type: 'turn_complete',
        turnCount: state.turnCount,
        ...EMPTY_TURN_METRICS,
        transition: 'done',
      }
      yield { type: 'state_change', state: 'done' }
      return
    }

    // 准备本轮 LLM 输入(system prompt + 历史轮的messages)
    const startedAt = performance.now()
    const messagesForQuery: ModelMessage[] = config.systemPrompt
      ? [{ role: 'system', content: config.systemPrompt }, ...state.messages]
      : [...state.messages]

    // 调一次 LLM(SDK 会同步把本轮 tool_call 也执行掉)
    let res: ReturnType<typeof streamText>
    try {
      res = streamText({
        model: createMiniMaxModel(config),
        messages: messagesForQuery,
        tools: ctx.tools,
        // 跑完本轮(LLM + 工具)就停，是否调用下一轮 LLM 由状态机决定
        stopWhen: stepCountIs(1),
        maxOutputTokens: config.maxTokens ?? 4096,
      })
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      const transition: Transition = { kind: 'error', error: err }
      state = { ...state, transition }

      yield {
        type: 'turn_complete',
        turnCount: state.turnCount,
        ...EMPTY_TURN_METRICS,
        transition: 'error',
      }
      yield { type: 'error', error: err }
      yield { type: 'state_change', state: 'error' }
      return
    }

    // 消费 Stream
    let hasStartedStreaming = false
    try {
      for await (const part of res.fullStream) {
        if (abort?.signal.aborted) {
          const transition: Transition = { kind: 'aborted' }
          state = { ...state, transition }
          yield {
            type: 'turn_complete',
            turnCount: state.turnCount,
            ...EMPTY_TURN_METRICS,
            transition: 'aborted',
          }
          yield { type: 'state_change', state: 'idle' }
          return
        }

        switch (part.type) {
          // LLM 输出 text token,首次进入 streaming 状态
          case 'text-delta':
            if (!hasStartedStreaming) {
              yield { type: 'state_change', state: 'streaming' }
              hasStartedStreaming = true
            }
            yield { type: 'text_delta', delta: part.text }
            break

          // LLM 决定调工具
          case 'tool-call':
            hasStartedStreaming = false
            yield { type: 'state_change', state: 'tool_calling' }
            yield {
              type: 'tool_call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.input as Record<string, unknown>,
            }
            break

          // 工具执行完毕,结果回灌
          case 'tool-result':
            yield {
              type: 'tool_result',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              result: part.output,
            }
            yield { type: 'state_change', state: 'thinking' }
            break

          case 'tool-error': {
            const message =
              part.error instanceof Error ? part.error.message : String(part.error)
            yield {
              type: 'tool_error',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              error: message,
            }
            yield { type: 'state_change', state: 'thinking' }
            break
          }

          case 'start-step':
            hasStartedStreaming = false
            break
        }
      }
    } catch (error) {
      if (abort?.signal.aborted) {
        const transition: Transition = { kind: 'aborted' }
        state = { ...state, transition }
        yield {
          type: 'turn_complete',
          turnCount: state.turnCount,
          ...EMPTY_TURN_METRICS,
          transition: 'aborted',
        }
        yield { type: 
        'state_change', state: 'idle' }
        return
      }
      const err = error instanceof Error ? error.message : String(error)
      const transition: Transition = { kind: 'error', error: err }
      state = { ...state, transition }
      yield {
        type: 'turn_complete',
        turnCount: state.turnCount,
        ...EMPTY_TURN_METRICS,
        transition: 'error',
      }
      yield { type: 'error', error: err }
      yield { type: 'state_change', state: 'error' }
      return
    }

    // 聚合本轮 message 的结果
    const [finishReason, response, usage, assistantText, toolCalls] = await Promise.all([
      res.finishReason,
      res.response, // 用于拼到下一轮message
      res.totalUsage, // token用量
      res.text, // 本轮 LLM 输出的纯文本
      res.toolCalls, // 本轮 LLM 决定调的工具列表
    ])
    const duration = Math.round(performance.now() - startedAt)
    const inputTokens = usage.inputTokens ?? 0
    const outputTokens = usage.outputTokens ?? 0
    const responseMessages = response.messages
    const toolCallCount = toolCalls.length

    if (finishReason === 'tool-calls') {
      state = {
        messages: [...state.messages, ...responseMessages],
        turnCount: state.turnCount + 1,
        totalInputTokens: state.totalInputTokens + inputTokens,
        totalOutputTokens: state.totalOutputTokens + outputTokens,
        transition: { kind: 'next_turn', toolCallCount },
      }
      yield {
        type: 'turn_complete',
        turnCount: state.turnCount,
        toolCallCount,
        inputTokens,
        outputTokens,
        assistantText,
        durationMs: duration,
        transition: 'next_turn',
      }
      // agent 状态 → thinking,准备进入下一轮
      yield { type: 'state_change', state: 'thinking' }
      continue
    }

    // error:SDK 主动报告 LLM 出错 → error 终止
    if (finishReason === 'error') {
      const err = 'LLM finished with error'
      state = { ...state, transition: { kind: 'error', error: err } }
      yield {
        type: 'turn_complete',
        turnCount: state.turnCount,
        toolCallCount,
        inputTokens,
        outputTokens,
        assistantText,
        durationMs: duration,
        transition: 'error',
      }
      yield { type: 'error', error: err }
      yield { type: 'state_change', state: 'error' }
      return
    }

    // stop / length / content-filter / other → done 终止(P2 加 recovery 时在此识别 'length')
    state = {
      messages: [...state.messages, ...responseMessages],
      turnCount: state.turnCount + 1,
      totalInputTokens: state.totalInputTokens + inputTokens,
      totalOutputTokens: state.totalOutputTokens + outputTokens,
      transition: { kind: 'done', reason: 'stop' },
    }
    yield {
      type: 'message_complete',
      message: createAssistantMessage(assistantText),
    }
    yield {
      type: 'turn_complete',
      turnCount: state.turnCount,
      toolCallCount,
      inputTokens,
      outputTokens,
      assistantText,
      durationMs: duration,
      transition: 'done',
    }
    yield { type: 'state_change', state: 'done' }
    return
  }
}
