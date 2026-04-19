import type { AgentEvent, AgentState, TaskEvent } from '@the-next/core'
import { useCallback, useState } from 'react'

/**
 * 单次工具调用的实时状态(从 tool_call 事件累积到 tool_result/tool_error)。
 */
export type RuntimeToolCall = {
  readonly toolCallId: string
  readonly toolName: string
  readonly args: Record<string, unknown>
  readonly status: 'calling' | 'done' | 'error'
  readonly result?: unknown
  readonly error?: string
  readonly turnNumber: number
  readonly startedAt: number
}

/**
 * 一个 turn 完成时的快照(状态机骨架的 turn_complete 事件投影)。
 *
 * `assistantText` 是本轮 LLM 输出的完整文本(可能为空)。
 * `durationMs` 是 turn 内部测量的执行时长,首轮也能拿到。
 */
export type RuntimeTurn = {
  readonly turnCount: number
  readonly toolCallCount: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly assistantText: string
  readonly durationMs: number
  readonly transition: 'next_turn' | 'done' | 'aborted' | 'error'
  readonly completedAt: number
}

/**
 * 单个 task 的运行时状态。
 *
 * 由 useTaskRuntime 维护一个 Map<taskId, TaskRuntimeState>,
 * 通过消费 task_agent_event 流增量更新。
 *
 * 这是"控制面"思路在 Task 模式下的落点:用户不只看到 status 字段,
 * 而是看到 agent 真的在做什么(thinking / 调哪个工具 / 已经跑了几轮 / 用了多少 token)。
 */
export type TaskRuntimeState = {
  /** 当前 agent 子状态(thinking / streaming / tool_calling / done / error / idle) */
  readonly agentState: AgentState
  /** 已完成的 turn 数(turn_complete 事件的累计) */
  readonly turnCount: number
  /** 累计输入/输出 token */
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  /** 本任务自启动以来产生的所有工具调用(实时更新) */
  readonly toolCalls: readonly RuntimeToolCall[]
  /** turn_complete 事件历史(显示"任务节奏") */
  readonly turns: readonly RuntimeTurn[]
  /** 当前轮正在流式输出的文本(message_complete 时清空) */
  readonly streamingText: string
  /** 最近一次 error 事件的内容(便于详情页展示失败原因) */
  readonly lastError?: string
}

const EMPTY_STATE: TaskRuntimeState = {
  agentState: 'idle',
  turnCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  toolCalls: [],
  turns: [],
  streamingText: '',
}

/**
 * 把单个 AgentEvent 应用到 TaskRuntimeState 上,返回新 state。
 *
 * 抽成纯函数便于测试,也保证 React state 更新的不可变性。
 */
function reduce(state: TaskRuntimeState, event: AgentEvent): TaskRuntimeState {
  switch (event.type) {
    case 'state_change':
      return { ...state, agentState: event.state }

    case 'text_delta':
      return { ...state, streamingText: state.streamingText + event.delta }

    case 'message_complete':
      // 一轮 LLM 回答完毕,流式缓冲清零(下一轮重新累积)
      return { ...state, streamingText: '' }

    case 'tool_call':
      return {
        ...state,
        toolCalls: [
          ...state.toolCalls,
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            status: 'calling',
            turnNumber: state.turnCount + 1,
            startedAt: Date.now(),
          },
        ],
      }

    case 'tool_result':
      return {
        ...state,
        toolCalls: state.toolCalls.map((tc) =>
          tc.toolCallId === event.toolCallId
            ? { ...tc, status: 'done' as const, result: event.result }
            : tc,
        ),
      }

    case 'tool_error':
      return {
        ...state,
        toolCalls: state.toolCalls.map((tc) =>
          tc.toolCallId === event.toolCallId
            ? { ...tc, status: 'error' as const, error: event.error }
            : tc,
        ),
      }

    case 'turn_complete':
      return {
        ...state,
        turnCount: event.turnCount,
        totalInputTokens: state.totalInputTokens + event.inputTokens,
        totalOutputTokens: state.totalOutputTokens + event.outputTokens,
        turns: [
          ...state.turns,
          {
            turnCount: event.turnCount,
            toolCallCount: event.toolCallCount,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            // 线上事件偶发缺字段时 JSON 反序列化会得到 undefined
            assistantText: event.assistantText ?? '',
            durationMs: event.durationMs,
            transition: event.transition,
            completedAt: Date.now(),
          },
        ],
      }

    case 'error':
      return { ...state, lastError: event.error }

    case 'permission_request':
      // 权限请求事件由 useAgent / 顶层处理,runtime 暂不消费
      return state

    default: {
      // 类型穷尽守卫
      const _exhaustive: never = event
      return state
    }
  }
}

/**
 * useTaskRuntime —— 维护所有 task 的运行时状态。
 *
 * 单例风格:整个 app 共享一份 Map<taskId, TaskRuntimeState>,
 * useTasks 在 WS 收到 task_agent_event 时调用 applyEvent。
 *
 * 任务被删除时调用 reset(taskId) 清理其 runtime 状态;
 * 任务重新执行时调用 reset(taskId) 重置(避免上一轮的 toolCalls 残留)。
 */
export function useTaskRuntime() {
  const [runtimes, setRuntimes] = useState<Record<string, TaskRuntimeState>>({})

  const applyEvent = useCallback((taskEvent: TaskEvent) => {
    if (taskEvent.type === 'task_agent_event') {
      const taskId = taskEvent.taskId
      const event = taskEvent.event
      setRuntimes((prev) => {
        const current = prev[taskId] ?? EMPTY_STATE
        const next = reduce(current, event)
        if (next === current) return prev
        return { ...prev, [taskId]: next }
      })
    } else if (taskEvent.type === 'task_status_changed') {
      // running 状态切换到非 running 时,把 streamingText 清空(避免残留)
      if (
        taskEvent.status === 'completed' ||
        taskEvent.status === 'failed' ||
        taskEvent.status === 'cancelled'
      ) {
        setRuntimes((prev) => {
          const current = prev[taskEvent.taskId]
          if (!current) return prev
          if (!current.streamingText && current.agentState !== 'streaming') return prev
          return {
            ...prev,
            [taskEvent.taskId]: { ...current, streamingText: '' },
          }
        })
      }
    }
  }, [])

  const reset = useCallback((taskId: string) => {
    setRuntimes((prev) => {
      if (!(taskId in prev)) return prev
      const { [taskId]: _removed, ...rest } = prev
      return rest
    })
  }, [])

  const getRuntime = useCallback(
    (taskId: string): TaskRuntimeState => runtimes[taskId] ?? EMPTY_STATE,
    [runtimes],
  )

  return { runtimes, applyEvent, reset, getRuntime }
}

export const EMPTY_RUNTIME_STATE = EMPTY_STATE
