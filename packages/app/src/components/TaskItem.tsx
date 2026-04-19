import type { Task } from '@the-next/core'
import { Circle, CircleCheck, Loader2, Play, Trash2 } from 'lucide-react'
import { cx } from '@/lib/utils'
import { TaskTypeBadge } from './TaskTypeBadge'

type TaskItemProps = {
  readonly task: Task
  readonly selected: boolean
  readonly onSelect: (id: string) => void
  readonly onRun: (id: string) => void
  readonly onDelete: (id: string) => void
}

function StatusIcon({ status }: { status: Task['status'] }) {
  switch (status) {
    case 'completed':
      return <CircleCheck className="size-5 text-emerald-500" />
    case 'running':
      return <Loader2 className="size-5 text-amber-500 animate-spin" />
    case 'failed':
      return <Circle className="size-5 text-red-500" />
    default:
      return <Circle className="size-5 text-muted-foreground/40" />
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function TaskItem({ task, selected, onSelect, onRun, onDelete }: TaskItemProps) {
  const canRun =
    task.status === 'pending' || task.status === 'failed' || task.status === 'scheduled'

  return (
    <button
      type="button"
      className={cx(
        'group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-colors text-left',
        selected ? 'bg-primary/10 border border-primary/20' : 'hover:bg-accent/50',
      )}
      onClick={() => onSelect(task.id)}
    >
      <div className="mt-0.5 shrink-0">
        <StatusIcon status={task.status} />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={cx(
            'text-sm font-medium truncate',
            task.status === 'completed' && 'line-through text-muted-foreground',
          )}
        >
          {task.title}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <TaskTypeBadge taskType={task.taskType} />
          <span className="text-[10px] text-muted-foreground">{formatTime(task.createdAt)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {canRun && (
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              onRun(task.id)
            }}
            title="执行"
          >
            <Play className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(task.id)
          }}
          title="删除"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </button>
  )
}
