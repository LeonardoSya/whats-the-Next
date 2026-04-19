import type { TaskType } from '@the-next/core'
import { cx } from '@/lib/utils'

const TYPE_CONFIG: Record<TaskType, { icon: string; label: string; color: string }> = {
  doc_edit: { icon: '📄', label: '文档', color: 'text-blue-600' },
  spreadsheet: { icon: '📊', label: '表格', color: 'text-emerald-600' },
  pdf_process: { icon: '📕', label: 'PDF', color: 'text-red-600' },
  presentation: { icon: '📽️', label: '演示', color: 'text-orange-600' },
  file_organize: { icon: '📁', label: '文件', color: 'text-yellow-600' },
  data_transform: { icon: '🔄', label: '数据', color: 'text-purple-600' },
  general: { icon: '💬', label: '通用', color: 'text-muted-foreground' },
}

type TaskTypeBadgeProps = {
  readonly taskType: TaskType
}

export function TaskTypeBadge({ taskType }: TaskTypeBadgeProps) {
  const config = TYPE_CONFIG[taskType]
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs', config.color)}>
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  )
}
