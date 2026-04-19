import type { ModelMessage } from 'ai'

/**
 * Agent Loop 的跨迭代状态。
 *
 * 状态机骨架的核心:每次循环迭代结束时,显式重写整个 state,
 * `state = { ...new values, transition: { kind: '...' } }`。
 */
export type AgentLoopState = {
  readonly messages: readonly ModelMessage[]
  readonly turnCount: number
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly transition?: Transition
}

export type Transition =
  /** 模型调了工具,工具结果已回灌,需要再问一次 LLM。 */
  | { readonly kind: 'next_turn'; readonly toolCallCount: number }
  | { readonly kind: 'done'; readonly reason: 'stop' }
  | { readonly kind: 'done'; readonly reason: 'max_turns' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'error'; readonly error: string }
