import { useState } from 'react'
import { cx } from '@/lib/utils'

type ToolCallInfo = {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  result?: unknown
  status: 'calling' | 'done' | 'error'
  error?: string
}

type ToolCallCardProps = {
  readonly toolCall: ToolCallInfo
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const statusConfig = {
  calling: {
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 animate-pulse',
    icon: '⟳',
    label: '调用中...',
  },
  done: {
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
    icon: '✓',
    label: '已完成',
  },
  error: {
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    icon: '✗',
    label: '执行失败',
  },
} as const

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const cfg = statusConfig[toolCall.status]

  return (
    <div className="mx-auto w-full max-w-3xl px-12">
      <div className="rounded-lg border border-border bg-muted/30 text-sm overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <span
            className={cx(
              'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
              cfg.badge,
            )}
          >
            {cfg.icon}
          </span>
          <code className="font-mono text-xs text-foreground/80">{toolCall.toolName}</code>
          <span className="ml-auto text-[10px] text-muted-foreground">{cfg.label}</span>
          <span
            className={cx(
              'text-[10px] text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
          >
            ▾
          </span>
        </button>

        {expanded && (
          <div className="border-t border-border px-3 py-2 space-y-2">
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                参数
              </p>
              <pre className="rounded bg-muted p-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                {formatJson(toolCall.args)}
              </pre>
            </div>
            {toolCall.result !== undefined && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  结果
                </p>
                <pre className="rounded bg-muted p-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                  {formatJson(toolCall.result)}
                </pre>
              </div>
            )}
            {toolCall.error && (
              <div>
                <p className="text-[10px] font-medium text-red-500 uppercase tracking-wider mb-1">
                  错误
                </p>
                <pre className="rounded bg-red-50 dark:bg-red-950/30 p-2 text-xs text-red-700 dark:text-red-400 overflow-x-auto whitespace-pre-wrap break-all">
                  {toolCall.error}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
