import type { AgentState } from '@the-next/core'
import { Activity, Layers, Loader2, MessageSquare, Wrench, Zap } from 'lucide-react'
import { useMemo } from 'react'
import {
  getActiveToolCalls,
  getStreamingText,
  getTotalToolCallCount,
  type TaskRuntimeState,
} from '@/hooks/useTaskRuntime'
import { cx } from '@/lib/utils'

type TaskRuntimeBarProps = {
  readonly runtime: TaskRuntimeState
  /** 任务自身的 status,用于决定是否显示"已停止"占位 */
  readonly taskStatus: string
}

const AGENT_STATE_LABELS: Record<AgentState, { text: string; tone: 'active' | 'idle' | 'error' }> =
  {
    idle: { text: '空闲', tone: 'idle' },
    thinking: { text: '思考中', tone: 'active' },
    streaming: { text: '生成中', tone: 'active' },
    tool_calling: { text: '调用工具', tone: 'active' },
    error: { text: '出错', tone: 'error' },
    done: { text: '完成', tone: 'idle' },
  }

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}

/**
 * TaskRuntimeBar —— 任务详情页的"运行时控制面"。
 *
 * 借鉴 Claude Code REPL 的核心思路:用户应该看到 agent 真的在做什么,
 * 而不只是看一个旋转图标。这里显式展示:
 * - 当前 agent 子状态(thinking / streaming / 调用某个工具)
 * - turn 进度(已完成几轮)
 * - 累计 token 消耗
 * - 当前正在执行的工具调用列表
 * - 流式输出的文本(预览)
 *
 * 任务未启动 / 已结束时,这个面板会缩成一个"空闲"占位条,
 * 不打扰静态 task 的浏览体验。
 */
export function TaskRuntimeBar({ runtime, taskStatus }: TaskRuntimeBarProps) {
  const isRunning = taskStatus === 'running'

  const activeToolCalls = useMemo(() => getActiveToolCalls(runtime), [runtime])
  const totalToolCallCount = useMemo(() => getTotalToolCallCount(runtime), [runtime])
  const streamingText = useMemo(() => getStreamingText(runtime), [runtime])

  const stateMeta = AGENT_STATE_LABELS[runtime.agentState]
  const totalTokens = runtime.totalInputTokens + runtime.totalOutputTokens

  // 没有运行时数据 + 任务非 running:不显示这个 bar(避免打扰)
  if (!isRunning && runtime.turnCount === 0 && totalToolCallCount === 0 && !streamingText) {
    return null
  }

  return (
    <div
      className={cx(
        'shrink-0 border-b border-border px-6 py-3',
        isRunning ? 'bg-primary/5' : 'bg-muted/30',
      )}
    >
      {/* 第一行:agent 状态 + 关键指标 */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* 状态指示 */}
        <div className="flex items-center gap-2">
          <span
            className={cx(
              'inline-block size-2 rounded-full',
              stateMeta.tone === 'active' && 'bg-primary animate-pulse',
              stateMeta.tone === 'idle' && 'bg-muted-foreground/40',
              stateMeta.tone === 'error' && 'bg-destructive',
            )}
          />
          <span
            className={cx(
              'text-xs font-semibold',
              stateMeta.tone === 'active' && 'text-primary',
              stateMeta.tone === 'idle' && 'text-muted-foreground',
              stateMeta.tone === 'error' && 'text-destructive',
            )}
          >
            {stateMeta.text}
          </span>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Turn 进度 */}
        <div
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          title="已完成 turn 数(LLM ↔ 工具 来回轮数)"
        >
          <Layers className="size-3.5" />
          <span>
            <span className="font-mono font-semibold text-foreground">{runtime.turnCount}</span>{' '}
            轮
          </span>
        </div>

        {/* 工具调用累计 */}
        {totalToolCallCount > 0 && (
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="本次执行已调用工具次数"
          >
            <Wrench className="size-3.5" />
            <span>
              <span className="font-mono font-semibold text-foreground">
                {totalToolCallCount}
              </span>{' '}
              次工具
            </span>
          </div>
        )}

        {/* Token 消耗 */}
        {totalTokens > 0 && (
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={`输入 ${runtime.totalInputTokens.toLocaleString()} · 输出 ${runtime.totalOutputTokens.toLocaleString()}`}
          >
            <Zap className="size-3.5" />
            <span>
              <span className="font-mono font-semibold text-foreground">
                {formatTokens(totalTokens)}
              </span>{' '}
              tokens
            </span>
          </div>
        )}

        {/* 错误信息(如果有) */}
        {runtime.lastError && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-destructive max-w-md truncate">
            <Activity className="size-3.5 shrink-0" />
            <span className="truncate" title={runtime.lastError}>
              {runtime.lastError}
            </span>
          </div>
        )}
      </div>

      {/* 第二行:当前正在执行的工具(运行中且有 active 工具时) */}
      {isRunning && activeToolCalls.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeToolCalls.map((tc) => (
            <span
              key={tc.toolCallId}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary border border-primary/20"
            >
              <Loader2 className="size-3 animate-spin" />
              {tc.toolName}
            </span>
          ))}
        </div>
      )}

      {/* 第三行:流式文本预览(只在有 streaming 内容时,内容来自 currentTurn 最后一个 text/thinking item) */}
      {isRunning && streamingText && (
        <div className="mt-2 flex items-start gap-2">
          <MessageSquare className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
          <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed font-mono">
            {streamingText}
          </p>
        </div>
      )}
    </div>
  )
}
