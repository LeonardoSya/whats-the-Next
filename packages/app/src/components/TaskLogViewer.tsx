import type { LogEntry, LogLevel, LogPhase } from '@the-next/core'
import { Bug, ChevronDown, Filter, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { discoverServer, getHttpBase } from '@/lib/server'
import { cx } from '@/lib/utils'

type TaskLogViewerProps = {
  readonly taskId: string
}

const LEVEL_STYLES: Record<LogLevel, { bg: string; text: string; label: string }> = {
  debug: { bg: 'bg-zinc-100', text: 'text-zinc-500', label: 'DBG' },
  info: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'INF' },
  warn: { bg: 'bg-amber-50', text: 'text-amber-600', label: 'WRN' },
  error: { bg: 'bg-red-50', text: 'text-red-600', label: 'ERR' },
}

const PHASE_LABELS: Partial<Record<LogPhase, string>> = {
  route: '路由',
  toolkit: '工具集',
  execute: '执行',
  agent_loop: 'Agent',
  tool_call: '工具调用',
  tool_result: '工具结果',
  llm_request: 'LLM请求',
  llm_response: 'LLM响应',
  schedule: '调度',
  permission: '权限',
  system: '系统',
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

function LogEntryRow({
  entry,
  isExpanded,
  onToggle,
}: {
  entry: LogEntry
  isExpanded: boolean
  onToggle: () => void
}) {
  const style = LEVEL_STYLES[entry.level]
  const hasData = entry.data && Object.keys(entry.data).length > 0

  return (
    <div className="group border-b border-border/50 last:border-b-0">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors text-xs"
        onClick={onToggle}
        disabled={!hasData}
      >
        {/* 时间 */}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground w-20">
          {formatTime(entry.timestamp)}
        </span>

        {/* 级别 */}
        <span
          className={cx(
            'shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase w-7 text-center',
            style.bg,
            style.text,
          )}
        >
          {style.label}
        </span>

        {/* 阶段 */}
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium min-w-14 text-center">
          {PHASE_LABELS[entry.phase] ?? entry.phase}
        </span>

        {/* 消息 */}
        <span className="flex-1 truncate text-foreground/80">{entry.message}</span>

        {/* 耗时 */}
        {entry.durationMs !== undefined && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {entry.durationMs}ms
          </span>
        )}

        {/* 展开箭头 */}
        {hasData && (
          <ChevronDown
            className={cx(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              isExpanded && 'rotate-180',
            )}
          />
        )}
      </button>

      {/* 展开的 data */}
      {isExpanded && hasData && (
        <div className="px-3 pb-2 ml-22">
          <pre className="rounded bg-muted/60 p-2 text-[10px] font-mono text-foreground/70 overflow-x-auto whitespace-pre-wrap wrap-break-word max-h-60">
            {JSON.stringify(entry.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

export function TaskLogViewer({ taskId }: TaskLogViewerProps) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set())
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all')
  const [phaseFilter, setPhaseFilter] = useState<LogPhase | 'all'>('all')
  const [showFilters, setShowFilters] = useState(false)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      await discoverServer()
      const params = new URLSearchParams()
      if (levelFilter !== 'all') params.set('level', levelFilter)
      if (phaseFilter !== 'all') params.set('phase', phaseFilter)
      params.set('limit', '1000')
      const res = await fetch(`${getHttpBase()}/api/tasks/${taskId}/logs?${params}`)
      const data = await res.json()
      setEntries(data.entries)
      setTotal(data.total)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [taskId, levelFilter, phaseFilter])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const toggleExpand = useCallback((index: number) => {
    setExpandedSet((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const phases = [...new Set(entries.map((e) => e.phase))]

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <Bug className="size-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Workflow 日志
        </h3>
        <span className="text-[10px] text-muted-foreground">
          ({total} 条{levelFilter !== 'all' || phaseFilter !== 'all' ? '，已过滤' : ''})
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="h-6 px-2"
          >
            <Filter className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchLogs}
            disabled={loading}
            className="h-6 px-2"
          >
            <RefreshCw className={cx('size-3', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 bg-muted/20">
          <span className="text-[10px] text-muted-foreground font-medium">级别:</span>
          {(['all', 'debug', 'info', 'warn', 'error'] as const).map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLevelFilter(lv)}
              className={cx(
                'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                levelFilter === lv
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              {lv === 'all' ? '全部' : lv.toUpperCase()}
            </button>
          ))}
          <span className="ml-2 text-[10px] text-muted-foreground font-medium">阶段:</span>
          <button
            type="button"
            onClick={() => setPhaseFilter('all')}
            className={cx(
              'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
              phaseFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            全部
          </button>
          {phases.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPhaseFilter(p)}
              className={cx(
                'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                phaseFilter === p
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              {PHASE_LABELS[p] ?? p}
            </button>
          ))}
        </div>
      )}

      {/* Log entries */}
      <ScrollArea className="flex-1">
        {entries.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Bug className="size-8 opacity-30" />
            <p className="text-xs">暂无日志，执行任务后将在此显示</p>
          </div>
        )}
        {entries.map((entry, i) => (
          <LogEntryRow
            key={`${entry.timestamp}-${entry.phase}-${entry.message.slice(0, 20)}`}
            entry={entry}
            isExpanded={expandedSet.has(i)}
            onToggle={() => toggleExpand(i)}
          />
        ))}
      </ScrollArea>
    </div>
  )
}
