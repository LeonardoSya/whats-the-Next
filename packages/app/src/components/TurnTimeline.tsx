import { cjk } from '@streamdown/cjk'
import { createCodePlugin } from '@streamdown/code'
import { mermaid } from '@streamdown/mermaid'
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  StopCircle,
} from 'lucide-react'
import { Fragment, useState } from 'react'
import { Streamdown } from 'streamdown'
import type {
  AgentRuntimeState,
  CurrentTurn,
  RuntimeTurn,
  TurnTimelineItem,
} from '@/hooks/useAgentRuntime'
import { cx } from '@/lib/utils'

type TurnTimelineProps = {
  readonly runtime: AgentRuntimeState
}

/**
 * Turn 的"异常结束态"才显示状态提示 —— done / next_turn 是默认期望,不打扰用户。
 * aborted / error 才有信息量(用户需要知道 agent 没正常完成)。
 */
const STATUS_META = {
  aborted: { label: '已中止', tone: 'text-muted-foreground', Icon: StopCircle },
  error: { label: '执行出错', tone: 'text-destructive', Icon: AlertTriangle },
} as const

const THINKING_COLLAPSE_THRESHOLD = 120

// ── streamdown 插件配置(模块顶层实例化,跨渲染复用) ─────────────
//
// code: vitesse 主题对齐项目偏柔和的暖米白底色
// cjk:  中文混排优化(emphasis/列表标记规则)
// mermaid: LLM 输出 ```mermaid 块时直接渲染图表
const code = createCodePlugin({ themes: ['vitesse-light', 'vitesse-dark'] })
const STREAMDOWN_PLUGINS = { code, cjk, mermaid }
const SHIKI_THEME: ['vitesse-light', 'vitesse-dark'] = ['vitesse-light', 'vitesse-dark']

// ── 三种 timeline item 的渲染组件 ─────────────────────────────

/**
 * 普通 LLM 文本输出 —— 用 streamdown 渲染 markdown(代码块/列表/链接/表格/mermaid)。
 *
 * 设计要点:
 * - text 是对话本体,不加卡片边框,跟工具卡片穿插时视觉上"嵌入对话流"
 * - prose-sm 锚定字号,prose-* 单元覆盖把段落/代码块的间距调到跟周围对话一致
 * - 流式中(`isStreaming=true`)开启光标动画,完成后停止
 * - 不再做长文本折叠 —— streamdown 内部代码块带横滚,长内容自然展开更符合 chat UX
 */
function TextBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return (
    <div
      className={cx(
        // 字号锚定 text-sm(跟 user 气泡和周围 chat 一致),不用 prose 默认放大
        'prose prose-sm max-w-none text-foreground/90',
        // 段落:行高对齐 ThinkingBlock 的 leading-relaxed (1.625),间距压到最紧
        'prose-p:my-1 prose-p:leading-relaxed',
        // 列表:间距同步收紧,列表项行高对齐
        'prose-ul:my-1 prose-ul:pl-5 prose-ol:my-1 prose-ol:pl-5',
        'prose-li:my-0.5 prose-li:leading-relaxed prose-li:marker:text-muted-foreground',
        // 标题:不让 LLM 的 ## 撑大版面(全部压回正文级字号),间距收紧
        'prose-headings:my-2 prose-headings:font-semibold prose-headings:text-foreground',
        'prose-h1:text-base prose-h2:text-base prose-h3:text-sm prose-h4:text-sm',
        // 代码块:背景柔和对齐项目主色
        'prose-pre:my-2 prose-pre:bg-muted/40 prose-pre:border prose-pre:border-border',
        // 行内 code:去掉 prose 默认的反引号 + 加 chip 样式
        'prose-code:text-foreground/85 prose-code:bg-muted/60 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
        // 链接:用主色,hover 才下划线
        'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
        // 强调
        'prose-strong:text-foreground prose-strong:font-semibold',
        // 引用块:去 prose 默认斜体,改细左边框
        'prose-blockquote:my-2 prose-blockquote:not-italic prose-blockquote:border-l-2 prose-blockquote:pl-3 prose-blockquote:text-foreground/80',
        // 水平线
        'prose-hr:my-3',
        // 防止 TextBlock 顶部/底部多余留白(让 turn 内多个 segment 视觉紧贴)
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
      )}
    >
      <Streamdown
        shikiTheme={SHIKI_THEME}
        plugins={STREAMDOWN_PLUGINS}
        animated
        isAnimating={isStreaming}
        caret="block"
      >
        {content}
      </Streamdown>
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
        {item.status === 'done' && <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />}
        {item.status === 'error' && <AlertTriangle className="size-3 shrink-0 text-destructive" />}

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
  | {
      kind: 'tool_group'
      items: Extract<TurnTimelineItem, { kind: 'tool_call' }>[]
      startIndex: number
    }

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
 *
 * `isStreaming` 仅对 text 有意义 —— 控制 streamdown 的光标闪烁动画,
 * 由 CurrentTurnRow 在"timeline 最后一个 segment 是 text"时传 true。
 */
function SegmentRow({
  segment,
  isStreaming = false,
}: {
  segment: RenderSegment
  isStreaming?: boolean
}) {
  if (segment.kind === 'single') {
    const item = segment.item
    if (item.kind === 'text') return <TextBlock content={item.content} isStreaming={isStreaming} />
    if (item.kind === 'thinking') return <ThinkingBlock content={item.content} />
    return null
  }

  return (
    <div className="ml-3 border-l-2 border-border/60 pl-2.5 space-y-0.5">
      {segment.items.map((item) => (
        <ToolCallBlock key={`tc-${item.toolCallId}`} item={item} />
      ))}
    </div>
  )
}

// ── 一个 turn 的整体渲染 ──────────────────────────────────────

/**
 * turn 异常结束(中止/出错)时的内联提示。done / next_turn 不渲染。
 */
function TurnStatusFooter({ transition }: { transition: 'aborted' | 'error' }) {
  const meta = STATUS_META[transition]
  const Icon = meta.Icon
  return (
    <div className={cx('flex items-center gap-1.5 text-[11px]', meta.tone)}>
      <Icon className="size-3" />
      <span>{meta.label}</span>
    </div>
  )
}

function CompletedTurnRow({ turn }: { turn: RuntimeTurn }) {
  const segments = buildSegments(turn.timeline)
  const statusTransition: 'aborted' | 'error' | null =
    turn.transition === 'aborted' || turn.transition === 'error' ? turn.transition : null

  return (
    <div className="space-y-1.5">
      {segments.length > 0 && (
        <div className="space-y-1">
          {segments.map((seg, idx) => (
            <SegmentRow key={segmentKey(seg, idx)} segment={seg} />
          ))}
        </div>
      )}
      {statusTransition && <TurnStatusFooter transition={statusTransition} />}
    </div>
  )
}

function CurrentTurnRow({ current }: { current: CurrentTurn }) {
  const segments = buildSegments(current.timeline)
  // 只有"timeline 最后一个 item 是 text"时,那段 text 还在流式累积 ——
  // 工具调用之后开始的新 text 才会真正流;前面被 tool_call 打断的 text 已经定型。
  const lastIdx = segments.length - 1
  const lastSeg = segments[lastIdx]
  const lastIsStreamingText = lastSeg?.kind === 'single' && lastSeg.item.kind === 'text'

  if (segments.length === 0) return null

  return (
    <div className="space-y-1">
      {segments.map((seg, idx) => (
        <SegmentRow
          key={segmentKey(seg, idx)}
          segment={seg}
          isStreaming={lastIsStreamingText && idx === lastIdx}
        />
      ))}
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
 * - text 是对话本体 → streamdown 渲染 markdown,跟 turn 自然流
 * - thinking 是辅助信息 → 灰色折叠块,显示前 3 行预览
 * - tool_call 是嵌入动作 → 缩进 + 左竖线,连续工具共享一组,视觉上"嵌入"文字流
 * - turn 元信息(轮数/duration/token)对用户没意义,完全省略
 * - 多 turn 之间用一根细的 divider 区分,失败/中止才显示状态提示
 *
 * 这样"被工具切碎的句子"读起来像"agent 边说边做",而不是"两段独立段落 + 中间的工具盒子"。
 */
export function TurnTimeline({ runtime }: TurnTimelineProps) {
  const isInactive = runtime.turns.length === 0 && !runtime.currentTurn

  if (isInactive) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
        <Activity className="size-6 opacity-30" />
        <p className="text-xs">等待 agent 开始响应...</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {runtime.turns.map((turn, idx) => (
        <Fragment key={`${turn.turnCount}-${turn.completedAt}`}>
          {idx > 0 && <div className="border-t border-border/30" />}
          <CompletedTurnRow turn={turn} />
        </Fragment>
      ))}
      {runtime.currentTurn && (
        <>
          {runtime.turns.length > 0 && <div className="border-t border-border/30" />}
          <CurrentTurnRow current={runtime.currentTurn} />
        </>
      )}
    </div>
  )
}
