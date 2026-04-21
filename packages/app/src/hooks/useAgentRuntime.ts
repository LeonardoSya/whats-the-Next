import type { AgentEvent, AgentState } from '@the-next/core'

/**
 * Turn 内的事件时间线项 —— 按事件到达顺序记录,UI 直接照序渲染。
 *
 * 三种类型:
 * - text:LLM 普通文本输出
 * - thinking:LLM reasoning 内容(从 <think>...</think> 标签解析出来)
 * - tool_call:工具调用(从发起到结果/错误回灌的完整生命周期)
 *
 * 连续的 text/thinking item 会自动合并(避免每个 token 都新开一项)。
 */
export type TurnTimelineItem =
  | { readonly kind: 'text'; readonly content: string }
  | { readonly kind: 'thinking'; readonly content: string }
  | {
      readonly kind: 'tool_call'
      readonly toolCallId: string
      readonly toolName: string
      readonly args: Record<string, unknown>
      readonly status: 'calling' | 'done' | 'error'
      readonly result?: unknown
      readonly error?: string
      readonly startedAt: number
    }

/**
 * 已完成的 turn 快照(由 turn_complete 事件落盘)。
 */
export type RuntimeTurn = {
  readonly turnCount: number
  readonly timeline: readonly TurnTimelineItem[]
  readonly inputTokens: number
  readonly outputTokens: number
  readonly durationMs: number
  readonly transition: 'next_turn' | 'done' | 'aborted' | 'error'
  readonly completedAt: number
}

/**
 * 正在跑的 turn(还没收到 turn_complete)—— 持有事件累积 + <think> 解析的中间状态。
 *
 * `rawBuffer` 用来跨 chunk 缓冲尾部可能不完整的 `<think>` / `</think>` 标签
 * (比如 chunk 边界把标签切成 "<thi" + "nk>");`thinkingMode` 标识当前累积的应当是
 * thinking 还是 text item。
 */
export type CurrentTurn = {
  readonly turnNumber: number
  readonly timeline: readonly TurnTimelineItem[]
  readonly thinkingMode: boolean
  readonly rawBuffer: string
}

/**
 * Agent 一次 session 的运行时状态(timeline-based 模型)。
 *
 * 数据组织:
 * - 已完成的 turn 累积在 `turns`,每个带自己的 timeline
 * - 正在跑的 turn 单独维护在 `currentTurn`,turn_complete 时迁移
 *
 * 不保留全局的 toolCalls / streamingText 字段 —— 它们是派生信息,
 * 通过 helper(getActiveToolCalls / getStreamingText / getTotalToolCallCount)按需计算。
 * 这样自然解决"跨 turn 残留"的问题(currentTurn 在 turn_complete 时整体清空)。
 */
export type AgentRuntimeState = {
  readonly agentState: AgentState
  readonly turnCount: number
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly turns: readonly RuntimeTurn[]
  readonly currentTurn?: CurrentTurn
  readonly lastError?: string
}

export const EMPTY_AGENT_RUNTIME: AgentRuntimeState = {
  agentState: 'idle',
  turnCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  turns: [],
}

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

// ── 不可变 timeline 操作 ──────────────────────────────────────────

function appendTextToTimeline(
  timeline: readonly TurnTimelineItem[],
  kind: 'text' | 'thinking',
  content: string,
): readonly TurnTimelineItem[] {
  if (!content) return timeline
  const last = timeline[timeline.length - 1]
  if (last && last.kind === kind) {
    return [...timeline.slice(0, -1), { ...last, content: last.content + content }]
  }
  return [...timeline, { kind, content }]
}

/**
 * Streaming-safe 的 <think> 标签解析。
 *
 * 处理一次新到的 text-delta:把 cur.rawBuffer + delta 按 <think>/</think> 切段,
 * 完整段落落到 timeline 对应 kind 的 item 里;尾部可能是不完整标签的字符留在 rawBuffer
 * 里等下一个 chunk(避免把 "<thi" 这种半截当成普通文本)。
 */
function processTextDelta(cur: CurrentTurn, delta: string): CurrentTurn {
  let timeline: readonly TurnTimelineItem[] = cur.timeline
  let mode = cur.thinkingMode
  let buffer = cur.rawBuffer + delta

  while (true) {
    if (mode) {
      const closeIdx = buffer.indexOf(THINK_CLOSE)
      if (closeIdx >= 0) {
        timeline = appendTextToTimeline(timeline, 'thinking', buffer.slice(0, closeIdx))
        buffer = buffer.slice(closeIdx + THINK_CLOSE.length)
        mode = false
        continue
      }
      if (buffer.length > THINK_CLOSE.length) {
        const flush = buffer.slice(0, buffer.length - THINK_CLOSE.length)
        timeline = appendTextToTimeline(timeline, 'thinking', flush)
        buffer = buffer.slice(-THINK_CLOSE.length)
      }
      break
    } else {
      const openIdx = buffer.indexOf(THINK_OPEN)
      if (openIdx >= 0) {
        timeline = appendTextToTimeline(timeline, 'text', buffer.slice(0, openIdx))
        buffer = buffer.slice(openIdx + THINK_OPEN.length)
        mode = true
        continue
      }
      if (buffer.length > THINK_OPEN.length) {
        const flush = buffer.slice(0, buffer.length - THINK_OPEN.length)
        timeline = appendTextToTimeline(timeline, 'text', flush)
        buffer = buffer.slice(-THINK_OPEN.length)
      }
      break
    }
  }

  return { ...cur, timeline, thinkingMode: mode, rawBuffer: buffer }
}

function ensureCurrent(state: AgentRuntimeState): CurrentTurn {
  return (
    state.currentTurn ?? {
      turnNumber: state.turnCount + 1,
      timeline: [],
      thinkingMode: false,
      rawBuffer: '',
    }
  )
}

// ── reducer ──────────────────────────────────────────────────────

/**
 * 核心 reducer —— 把一个 AgentEvent 折叠进 runtime state。
 *
 * 所有返回新对象都是不可变的(即便内部 timeline 只变了一个 item,
 * 也会返回全新的 state/turns/timeline 引用)。
 */
export function applyAgentEvent(state: AgentRuntimeState, event: AgentEvent): AgentRuntimeState {
  switch (event.type) {
    case 'state_change':
      return { ...state, agentState: event.state }

    case 'text_delta': {
      const cur = ensureCurrent(state)
      return { ...state, currentTurn: processTextDelta(cur, event.delta) }
    }

    case 'tool_call': {
      const cur = ensureCurrent(state)
      return {
        ...state,
        currentTurn: {
          ...cur,
          timeline: [
            ...cur.timeline,
            {
              kind: 'tool_call',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              status: 'calling',
              startedAt: Date.now(),
            },
          ],
        },
      }
    }

    case 'tool_result': {
      if (!state.currentTurn) return state
      return {
        ...state,
        currentTurn: {
          ...state.currentTurn,
          timeline: state.currentTurn.timeline.map((item) =>
            item.kind === 'tool_call' && item.toolCallId === event.toolCallId
              ? { ...item, status: 'done' as const, result: event.result }
              : item,
          ),
        },
      }
    }

    case 'tool_error': {
      if (!state.currentTurn) return state
      return {
        ...state,
        currentTurn: {
          ...state.currentTurn,
          timeline: state.currentTurn.timeline.map((item) =>
            item.kind === 'tool_call' && item.toolCallId === event.toolCallId
              ? { ...item, status: 'error' as const, error: event.error }
              : item,
          ),
        },
      }
    }

    case 'turn_complete': {
      // 把 currentTurn 落盘到 turns。currentTurn 可能不存在(max_turns/aborted/error
      // 这种没真正跑 turn 就 emit 的场景)—— 此时 timeline 为空。
      let timeline: readonly TurnTimelineItem[] = state.currentTurn?.timeline ?? []
      // flush rawBuffer 里的尾巴(turn 结束时不再需要等"可能是标签前缀"了)
      if (state.currentTurn?.rawBuffer) {
        const kind = state.currentTurn.thinkingMode ? 'thinking' : 'text'
        timeline = appendTextToTimeline(timeline, kind, state.currentTurn.rawBuffer)
      }

      return {
        ...state,
        turnCount: event.turnCount,
        totalInputTokens: state.totalInputTokens + event.inputTokens,
        totalOutputTokens: state.totalOutputTokens + event.outputTokens,
        turns: [
          ...state.turns,
          {
            turnCount: event.turnCount,
            timeline,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            durationMs: event.durationMs,
            transition: event.transition,
            completedAt: Date.now(),
          },
        ],
        currentTurn: undefined,
      }
    }

    case 'message_complete':
      // timeline 模型下不再消费 —— 文本已经通过 text_delta 增量落到 timeline 了
      return state

    case 'error':
      return { ...state, lastError: event.error }

    case 'permission_request':
      return state

    default: {
      const _exhaustive: never = event
      return state
    }
  }
}

// ── 派生 helper(给 UI 组件用) ──────────────────────────────────

/** 当前正在调用中(还没拿到结果)的工具列表 —— 给 RuntimeBar 显示"正在执行" */
export function getActiveToolCalls(
  state: AgentRuntimeState,
): readonly Extract<TurnTimelineItem, { kind: 'tool_call' }>[] {
  if (!state.currentTurn) return []
  return state.currentTurn.timeline.filter(
    (item): item is Extract<TurnTimelineItem, { kind: 'tool_call' }> =>
      item.kind === 'tool_call' && item.status === 'calling',
  )
}

/** 当前正在累积的 streaming 文本(currentTurn 的最后一个 text/thinking item) */
export function getStreamingText(state: AgentRuntimeState): string {
  if (!state.currentTurn) return ''
  const last = state.currentTurn.timeline[state.currentTurn.timeline.length - 1]
  if (last?.kind === 'text' || last?.kind === 'thinking') return last.content
  return ''
}

/** 累计调用过的工具次数(turns 历史 + currentTurn) */
export function getTotalToolCallCount(state: AgentRuntimeState): number {
  let count = 0
  for (const turn of state.turns) {
    for (const item of turn.timeline) {
      if (item.kind === 'tool_call') count++
    }
  }
  if (state.currentTurn) {
    for (const item of state.currentTurn.timeline) {
      if (item.kind === 'tool_call') count++
    }
  }
  return count
}
