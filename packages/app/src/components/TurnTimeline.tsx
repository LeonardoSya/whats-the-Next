import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Layers,
  MessageSquare,
  StopCircle,
} from 'lucide-react'
import { useState } from 'react'
import type { RuntimeToolCall, RuntimeTurn, TaskRuntimeState } from '@/hooks/useTaskRuntime'
import { ScrollArea } from './ui/scroll-area'
import { cx } from '@/lib/utils'

type TurnTimelineProps = {
  readonly runtime: TaskRuntimeState
}

const TRANSITION_META: Record<
  RuntimeTurn['transition'],
  { label: string; tone: string; Icon: typeof Layers }
> = {
  next_turn: { label: '继续下一轮', tone: 'text-primary bg-primary/10', Icon: ChevronRight },
  done: { label: '正常结束', tone: 'text-emerald-600 bg-emerald-50', Icon: CheckCircle2 },
  aborted: { label: '已中止', tone: 'text-zinc-600 bg-zinc-100', Icon: StopCircle },
  error: { label: '出错', tone: 'text-destructive bg-destructive/10', Icon: AlertTriangle },
}

// 文本超过这个长度才提供折叠开关(短文本直接全展示更舒服)
const TEXT_COLLAPSE_THRESHOLD = 240

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

function ToolCallRow({ toolCall }: { toolCall: RuntimeToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const hasArgs = Object.keys(toolCall.args).length > 0
  const hasResult = toolCall.result !== undefined
  const canExpand = hasArgs || hasResult || toolCall.error

  return (
    <div className="rounded-md border border-border/60 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => canExpand && setExpanded(!expanded)}
        disabled={!canExpand}
        className={cx(
          'flex w-full items-center gap-2 px-2.5 py-1.5 text-xs',
          canExpand && 'hover:bg-muted/40 cursor-pointer',
        )}
      >
        {/* 工具状态图标 */}
        {toolCall.status === 'calling' && (
          <span className="size-2.5 shrink-0 rounded-full bg-primary animate-pulse" />
        )}
        {toolCall.status === 'done' && (
          <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
        )}
        {toolCall.status === 'error' && (
          <AlertTriangle className="size-3 shrink-0 text-destructive" />
        )}

        <span className="font-mono font-medium text-foreground">{toolCall.toolName}</span>
        <span className="text-[10px] text-muted-foreground">turn #{toolCall.turnNumber}</span>

        {canExpand && (
          <ChevronRight
            className={cx(
              'ml-auto size-3 text-muted-foreground transition-transform',
              expanded && 'rotate-90',
            )}
          />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/60 bg-muted/30 px-2.5 py-2 space-y-1.5">
          {hasArgs && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                参数
              </div>
              <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap wrap-break-word max-h-40 overflow-auto">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {hasResult && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                结果
              </div>
              <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap wrap-break-word max-h-40 overflow-auto">
                {typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.error && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-destructive mb-1">
                错误
              </div>
              <pre className="text-[11px] font-mono text-destructive whitespace-pre-wrap wrap-break-word">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * AssistantTextBlock —— 展示一个 turn 内 LLM 输出的文本。
 *
 * 设计原则:
 * - 文本是状态机视角下"LLM 这一轮说了什么"的快照,跟工具调用并列,
 *   而不是"对话历史"里的一条消息(那是另一个 lens 的事)。
 * - 短文本直接展开,长文本默认 line-clamp-4 + 展开按钮,避免单 turn
 *   霸屏(LLM 偶尔会一口气写很长的 reasoning)。
 * - 等宽 + 灰底 + 左侧引号槽,跟工具行明显区分。
 */
function AssistantTextBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > TEXT_COLLAPSE_THRESHOLD
  const showExpander = isLong

  return (
    <div className="rounded-md border-l-2 border-border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <MessageSquare className="size-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          LLM 输出
        </span>
        <span className="text-[10px] text-muted-foreground">
          {text.length} 字
        </span>
      </div>
      <p
        className={cx(
          'text-xs text-foreground/80 whitespace-pre-wrap wrap-break-word leading-relaxed',
          showExpander && !expanded && 'line-clamp-4',
        )}
      >
        {text}
      </p>
      {showExpander && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] font-medium text-primary hover:underline"
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </div>
  )
}

/**
 * TurnRow —— 一个已完成 turn 的完整呈现。
 *
 * 包含三类内容(对应 turn 内可能发生的所有事):
 * 1. Turn 头:编号 + transition + 工具数 + 时长 + token
 * 2. LLM 输出文本(如果有)
 * 3. 工具调用列表(每个可独立展开看 args / result / error)
 *
 * 顺序刻意是"先文本后工具",反映 LLM 的真实行为:
 * 通常先想/解释一段话,再决定调哪些工具。
 */
function TurnRow({
  turn,
  toolCalls,
}: {
  turn: RuntimeTurn
  toolCalls: readonly RuntimeToolCall[]
}) {
  const meta = TRANSITION_META[turn.transition]
  const Icon = meta.Icon
  const assistantText = turn.assistantText ?? ''
  const hasText = assistantText.trim().length > 0

  return (
    <div className="space-y-2">
      {/* Turn 头 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11px] font-mono font-semibold text-foreground">
          <Layers className="size-3" />
          Turn {turn.turnCount}
        </div>
        <div
          className={cx(
            'flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium',
            meta.tone,
          )}
        >
          <Icon className="size-3" />
          {meta.label}
        </div>
        {turn.toolCallCount > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {turn.toolCallCount} 个工具
          </span>
        )}
        {turn.durationMs > 0 && (
          <span
            className="text-[10px] text-muted-foreground font-mono"
            title="本轮内部测量的执行时长(LLM 调用 + 工具执行)"
          >
            {formatDuration(turn.durationMs)}
          </span>
        )}
        <span
          className="text-[10px] text-muted-foreground font-mono ml-auto"
          title={`输入 ${turn.inputTokens} · 输出 ${turn.outputTokens}`}
        >
          ↑{turn.inputTokens} ↓{turn.outputTokens}
        </span>
      </div>

      {/* LLM 输出文本(如果非空) */}
      {hasText && (
        <div className="ml-4">
          <AssistantTextBlock text={assistantText} />
        </div>
      )}

      {/* 工具调用列表 */}
      {toolCalls.length > 0 && (
        <div className="ml-4 space-y-1">
          {toolCalls.map((tc) => (
            <ToolCallRow key={tc.toolCallId} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * TurnTimeline —— 把 turn_complete + tool_call + assistant text 事件流可视化成"执行节奏"。
 *
 * 每个 turn 一组,完整呈现:
 * - turn 编号 + transition + 时长 / token
 * - LLM 这一轮说了什么(assistantText)
 * - LLM 这一轮调了什么(tool calls)
 *
 * 跟"对话记录"tab 的区别:
 * - 对话记录 = LLM 消息历史(用户 / 助手 / 工具调用),给"看结果"的用户
 * - 执行实况 = 状态机视角(turn / transition / runtime metrics),给"诊断流程"的用户
 *
 * 两者来自同一个事件流,但 lens 不同。
 */
export function TurnTimeline({ runtime }: TurnTimelineProps) {
  const isInactive =
    runtime.turnCount === 0 && runtime.toolCalls.length === 0 && !runtime.streamingText

  if (isInactive) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Activity className="size-8 opacity-30" />
        <p className="text-xs">尚未执行,点击"执行"按钮后这里会实时显示 agent 的运行节奏</p>
      </div>
    )
  }

  // 把 toolCalls 按 turnNumber 分组,绑到对应 turn 上展示
  const callsByTurn = new Map<number, RuntimeToolCall[]>()
  for (const tc of runtime.toolCalls) {
    const arr = callsByTurn.get(tc.turnNumber) ?? []
    arr.push(tc)
    callsByTurn.set(tc.turnNumber, arr)
  }

  // 当前正在跑的轮次(还没 turn_complete):turnCount + 1
  const ongoingTurn = runtime.agentState !== 'idle' && runtime.agentState !== 'done'
  const ongoingTurnNumber = runtime.turnCount + 1
  const ongoingCalls = callsByTurn.get(ongoingTurnNumber) ?? []

  return (
    <ScrollArea className="flex-1">
      <div className="px-6 py-3 space-y-3">
        {/* ── 已完成的 turn 列表 ── */}
        {runtime.turns.map((turn) => (
          <TurnRow
            key={`${turn.turnCount}-${turn.completedAt}`}
            turn={turn}
            toolCalls={callsByTurn.get(turn.turnCount) ?? []}
          />
        ))}

        {/* ── 当前正在跑的 turn(占位) ── */}
        {ongoingTurn && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-primary border border-primary/20">
                <Layers className="size-3" />
                Turn {ongoingTurnNumber}
              </div>
              <div className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-primary bg-primary/10">
                <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                进行中
              </div>
            </div>

            {ongoingCalls.length > 0 && (
              <div className="ml-4 space-y-1">
                {ongoingCalls.map((tc) => (
                  <ToolCallRow key={tc.toolCallId} toolCall={tc} />
                ))}
              </div>
            )}

            {runtime.streamingText && (
              <div className="ml-4 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">
                  正在生成
                </div>
                <p className="text-xs text-foreground/80 whitespace-pre-wrap wrap-break-word leading-relaxed">
                  {runtime.streamingText}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
