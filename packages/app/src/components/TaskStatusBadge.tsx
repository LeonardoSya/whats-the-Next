import type { TaskStatus } from '@the-next/core'
import { cx } from '@/lib/utils'

const STATUS_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
  pending: {
    label: '待执行',
    className: 'bg-secondary text-secondary-foreground',
  },
  scheduled: {
    label: '已排期',
    className: 'bg-blue-100 text-blue-700',
  },
  running: {
    label: '执行中',
    className: 'bg-amber-100 text-amber-700 animate-pulse',
  },
  completed: {
    label: '已完成',
    className: 'bg-emerald-100 text-emerald-700',
  },
  failed: {
    label: '失败',
    className: 'bg-red-100 text-red-700',
  },
  cancelled: {
    label: '已取消',
    className: 'bg-muted text-muted-foreground',
  },
}

type TaskStatusBadgeProps = {
  readonly status: TaskStatus
}

export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}
