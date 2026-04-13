import type { AgentState } from '@the-next/core'
import { cx } from '@/lib/utils'

/** 状态指示器组件属性 */
type StatusIndicatorProps = {
  /** 当前 Agent 运行状态 */
  readonly state: AgentState
}

/** Agent 状态对应的中文标签 */
const STATE_LABELS: Record<AgentState, string> = {
  idle: '就绪',
  thinking: '思考中',
  streaming: '生成中',
  tool_calling: '调用工具',
  error: '出错了',
  done: '完成',
}

/**
 * 状态指示器组件
 *
 * 显示一个彩色圆点 + 状态文字，
 * 活跃状态（thinking/streaming/tool_calling）带脉冲动画。
 */
export function StatusIndicator({ state }: StatusIndicatorProps) {
  const isActive = state === 'thinking' || state === 'streaming' || state === 'tool_calling'
  const isError = state === 'error'

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={cx(
          'inline-block size-2 rounded-full',
          isError && 'bg-destructive',
          isActive && 'bg-primary animate-pulse',
          !isError && !isActive && 'bg-muted-foreground/40',
        )}
      />
      <span
        className={cx(
          'font-medium',
          isError && 'text-destructive',
          isActive && 'text-primary',
          !isError && !isActive && 'text-muted-foreground',
        )}
      >
        {STATE_LABELS[state]}
      </span>
    </div>
  )
}
