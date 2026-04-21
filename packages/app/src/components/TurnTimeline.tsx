import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  Layers,
  StopCircle,
} from 'lucide-react'
import { useState } from 'react'
import type {
  CurrentTurn,
  RuntimeTurn,
  TaskRuntimeState,
  TurnTimelineItem,
} from '@/hooks/useTaskRuntime'
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

const TEXT_COLLAPSE_THRESHOLD = 360
const THINKING_COLLAPSE_THRESHOLD = 120

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

// ── 三种 timeline item 的渲染组件 ─────────────────────────────

/**
 * 普通 LLM 文本输出。直接 <p>,不加卡片边框 —— text 是对话本体,
 * 不该被框包成"独立段落",这样工具卡片穿插时才能视觉上像"嵌入对话流"。
 */
function TextBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = content.length > TEXT_COLLAPSE_THRESHOLD

  return (
    <div>
      <p
        className={cx(
          'text-xs text-foreground/85 whitespace-pre-wrap wrap-break-word leading-relaxed',
          isLong && !expanded && 'line-clamp-6',
        )}
      >
        {content}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] font-medium text-primary hover:underline"
        >
          {expanded ? '收起' : `展开全文(${content.length} 字)`}
        </button>
      )}
    </div>
  )
}

/**
 * LLM reasoning 内容(从 <think>...</think> 解析出来)。
 *
 * 折叠时显示前 3 行,点击展开看全文。灰色斜体 + 脑图标,跟正式回答视觉区分。
 */
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = content.length > THINKING_COLLAPSE_THRESHOLD

  return (
    <div className="rounded-md bg-muted/40 border border-dashed border-border px-3 py-1.5">
      <button
        type="button"
        onClick={() => isLong && setExpanded(!expanded)}
        disabled={!isLong}
        className={cx('flex items-start gap-1.5 w-full text-left', isLong && 'cursor-pointer')}
      >
        <Brain className="size-3 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
            <span>思考</span>
            <span className="font-mono">({content.length} 字)</span>
            {isLong && (
              <ChevronRight
                className={cx('size-3 transition-transform', expanded && 'rotate-90')}
              />
            )}
          </div>
          <p
            className={cx(
              'text-[11px] text-muted-foreground/90 italic whitespace-pre-wrap wrap-break-word leading-relaxed',
              !expanded && 'line-clamp-3',
            )}
          >
            {content}
          </p>
        </div>
      </button>
    </div>
  )
}

/**
 * 工具调用块 —— 轻量化布局,跟文字流自然嵌合。
 * 默认折叠成一行 `▸ ✓ toolname`,点击展开看 args/result/error。
 */
function ToolCallBlock({ item }: { item: Extract<TurnTimelineItem, { kind: 'tool_call' }> }) {
  const [expanded, setExpanded] = useState(false)
  const hasArgs = Object.keys(item.args).length > 0
  const hasResult = item.result !== undefined
  const canExpand = hasArgs || hasResult || item.error

  return (
    <div className="rounded bg-muted/30 hover:bg-muted/50 transition-colors overflow-hidden">
      <button
        type="button"
        onClick={() => canExpand && setExpanded(!expanded)}
        disabled={!canExpand}
        className={cx(
          'flex w-full items-center gap-1.5 px-2 py-1 text-[11px]',
          canExpand && 'cursor-pointer',
        )}
      >
        {item.status === 'calling' && (
          <span className="size-2 shrink-0 rounded-full bg-primary animate-pulse" />
        )}
        {item.status === 'done' && (
          <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
        )}
        {item.status === 'error' && (
          <AlertTriangle className="size-3 shrink-0 text-destructive" />
        )}

        <span className="font-mono font-medium text-foreground/90">{item.toolName}</span>

        {canExpand && (
          <ChevronRight
            className={cx(
              'ml-auto size-3 text-muted-foreground/70 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/40 bg-background/50 px-2 py-1.5 space-y-1.5">
          {hasArgs && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                参数
              </div>
              <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap wrap-break-word max-h-40 overflow-auto">
                {JSON.stringify(item.args, null, 2)}
              </pre>
            </div>
          )}
          {hasResult && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                结果
              </div>
              <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap wrap-break-word max-h-40 overflow-auto">
                {typeof item.result === 'string'
                  ? item.result
                  : JSON.stringify(item.result, null, 2)}
              </pre>
            </div>
          )}
          {item.error && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-destructive mb-1">
                错误
              </div>
              <pre className="text-[11px] font-mono text-destructive whitespace-pre-wrap wrap-break-word">
                {item.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 渲染编排:把 timeline 分组成 "单 item" 和 "连续 tool 组" ──────────

/**
 * 一个渲染段 —— 要么是单个 timeline item,要么是连续的 tool_call 组(共享左竖线)。
 */
type RenderSegment =
  | { kind: 'single'; item: TurnTimelineItem; index: number }
  | { kind: 'tool_group'; items: Extract<TurnTimelineItem, { kind: 'tool_call' }>[]; startIndex: number }

/**
 * 把 timeline 切分成渲染段。连续的 tool_call 合并成一组,文字/思考独立成段。
 * 这样 UI 上能给同组工具加共享的左侧竖线,视觉成"一组中间动作"。
 */
function buildSegments(timeline: readonly TurnTimelineItem[]): RenderSegment[] {
  const segments: RenderSegment[] = []
  let toolBuffer: Extract<TurnTimelineItem, { kind: 'tool_call' }>[] = []
  let toolBufferStart = 0

  const flushTools = () => {
    if (toolBuffer.length > 0) {
      segments.push({ kind: 'tool_group', items: toolBuffer, startIndex: toolBufferStart })
      toolBuffer = []
    }
  }

  timeline.forEach((item, index) => {
    // 空文字 / 空思考(trim 后无内容):整个 item 不参与渲染
    if ((item.kind === 'text' || item.kind === 'thinking') && !item.content.trim()) {
      flushTools()
      return
    }

    if (item.kind === 'tool_call') {
      if (toolBuffer.length === 0) toolBufferStart = index
      toolBuffer.push(item)
      return
    }

    flushTools()
    segments.push({ kind: 'single', item, index })
  })

  flushTools()
  return segments
}

/**
 * 渲染单个 segment。tool_group 加左竖线 + 缩进,视觉上"嵌入"在前后文字之间。
 */
function SegmentRow({ segment }: { segment: RenderSegment }) {
  if (segment.kind === 'single') {
    const item = segment.item
    if (item.kind === 'text') return <TextBlock content={item.content} />
    if (item.kind === 'thinking') return <ThinkingBlock content={item.content} />
    return null
  }

  // tool_group:左侧细竖线 + 缩进,所有 tool_call 视觉上是"一组动作"
  return (
    <div className="ml-3 border-l-2 border-border/60 pl-2.5 space-y-0.5">
      {segment.items.map((item) => (
        <ToolCallBlock key={`tc-${item.toolCallId}`} item={item} />
      ))}
    </div>
  )
}

// ── 一个 turn 的整体渲染 ──────────────────────────────────────

function TurnHeader({
  turn,
  ongoing,
  toolCallCount,
}: {
  turn?: RuntimeTurn
  ongoing?: { turnNumber: number }
  toolCallCount: number
}) {
  const isOngoing = !turn && !!ongoing
  const turnNumber = turn?.turnCount ?? ongoing?.turnNumber ?? 0
  const meta = turn ? TRANSITION_META[turn.transition] : undefined
  const Icon = meta?.Icon

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div
        className={cx(
          'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-mono font-semibold',
          isOngoing
            ? 'bg-primary/10 text-primary border border-primary/20'
            : 'bg-muted text-foreground',
        )}
      >
        <Layers className="size-3" />
        Turn {turnNumber}
      </div>
      {meta && Icon ? (
        <div
          className={cx(
            'flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium',
            meta.tone,
          )}
        >
          <Icon className="size-3" />
          {meta.label}
        </div>
      ) : isOngoing ? (
        <div className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-primary bg-primary/10">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          进行中
        </div>
      ) : null}
      {toolCallCount > 0 && (
        <span className="text-[10px] text-muted-foreground">{toolCallCount} 个工具</span>
      )}
      {turn && turn.durationMs > 0 && (
        <span
          className="text-[10px] text-muted-foreground font-mono"
          title="本轮内部测量的执行时长(LLM 调用 + 工具执行)"
        >
          {formatDuration(turn.durationMs)}
        </span>
      )}
      {turn && (
        <span
          className="text-[10px] text-muted-foreground font-mono ml-auto"
          title={`输入 ${turn.inputTokens} · 输出 ${turn.outputTokens}`}
        >
          ↑{turn.inputTokens} ↓{turn.outputTokens}
        </span>
      )}
    </div>
  )
}

function CompletedTurnRow({ turn }: { turn: RuntimeTurn }) {
  const segments = buildSegments(turn.timeline)
  const toolCallCount = turn.timeline.filter((i) => i.kind === 'tool_call').length

  return (
    <div className="space-y-1.5">
      <TurnHeader turn={turn} toolCallCount={toolCallCount} />
      {segments.length > 0 && (
        <div className="space-y-1">
          {segments.map((seg, idx) => (
            <SegmentRow key={segmentKey(seg, idx)} segment={seg} />
          ))}
        </div>
      )}
    </div>
  )
}

function CurrentTurnRow({ current }: { current: CurrentTurn }) {
  const segments = buildSegments(current.timeline)
  const toolCallCount = current.timeline.filter((i) => i.kind === 'tool_call').length

  return (
    <div className="space-y-1.5">
      <TurnHeader ongoing={{ turnNumber: current.turnNumber }} toolCallCount={toolCallCount} />
      {segments.length > 0 && (
        <div className="space-y-1">
          {segments.map((seg, idx) => (
            <SegmentRow key={segmentKey(seg, idx)} segment={seg} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 段稳定 key:tool_group 用第一个 toolCallId,single 用 kind+index。 */
function segmentKey(seg: RenderSegment, idx: number): string {
  if (seg.kind === 'tool_group') return `tg-${seg.items[0]?.toolCallId ?? idx}`
  return `${seg.item.kind}-${seg.index}`
}

// ── 总入口 ───────────────────────────────────────────────────

/**
 * TurnTimeline —— 按事件时序展示 agent 的运行节奏。
 *
 * 视觉设计原则(对齐 Cursor / Claude Code):
 * - text 是对话本体 → 直接 <p>,无边框,跟 turn 自然流
 * - thinking 是辅助信息 → 灰色折叠块,显示前 3 行预览
 * - tool_call 是嵌入动作 → 缩进 + 左竖线,连续工具共享一组,视觉上"嵌入"文字流
 *
 * 这样"被工具切碎的句子"读起来像"agent 边说边做",而不是"两段独立段落 + 中间的工具盒子"。
 */
export function TurnTimeline({ runtime }: TurnTimelineProps) {
  const isInactive = runtime.turns.length === 0 && !runtime.currentTurn

  if (isInactive) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Activity className="size-8 opacity-30" />
        <p className="text-xs">尚未执行,点击"执行"按钮后这里会实时显示 agent 的运行节奏</p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="px-6 py-3 space-y-4">
        {runtime.turns.map((turn) => (
          <CompletedTurnRow key={`${turn.turnCount}-${turn.completedAt}`} turn={turn} />
        ))}
        {runtime.currentTurn && <CurrentTurnRow current={runtime.currentTurn} />}
      </div>
    </ScrollArea>
  )
}
