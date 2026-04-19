import type { Task, TaskStatus } from '@the-next/core'
import { CheckCircle2, Clock, ListTodo, Settings } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { TaskRuntimeState } from '@/hooks/useTaskRuntime'
import { cx } from '@/lib/utils'
import { QuickAdd } from './QuickAdd'
import { TaskItem } from './TaskItem'
import { ScrollArea } from './ui/scroll-area'

type FilterKey = 'all' | 'active' | 'completed'

const FILTERS: Array<{ key: FilterKey; label: string; icon: typeof ListTodo }> = [
  { key: 'all', label: '全部', icon: ListTodo },
  { key: 'active', label: '进行中', icon: Clock },
  { key: 'completed', label: '已完成', icon: CheckCircle2 },
]

const ACTIVE_STATUSES: TaskStatus[] = ['pending', 'scheduled', 'running', 'failed']

type TaskListSidebarProps = {
  readonly tasks: Task[]
  /** 所有任务的实时运行时状态(taskId → runtime) */
  readonly runtimes: Record<string, TaskRuntimeState>
  readonly selectedId: string | null
  readonly onSelect: (id: string) => void
  readonly onAdd: (description: string) => void
  readonly onRun: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly onOpenSettings: () => void
  readonly connected: boolean
}

export function TaskListSidebar({
  tasks,
  runtimes,
  selectedId,
  onSelect,
  onAdd,
  onRun,
  onDelete,
  onOpenSettings,
  connected,
}: TaskListSidebarProps) {
  const [filter, setFilter] = useState<FilterKey>('all')

  const filteredTasks = useMemo(() => {
    switch (filter) {
      case 'active':
        return tasks.filter((t) => ACTIVE_STATUSES.includes(t.status))
      case 'completed':
        return tasks.filter((t) => t.status === 'completed' || t.status === 'cancelled')
      default:
        return tasks
    }
  }, [tasks, filter])

  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length,
      completed: tasks.filter((t) => t.status === 'completed' || t.status === 'cancelled').length,
    }),
    [tasks],
  )

  return (
    <div className="flex h-full w-80 flex-col border-r border-border bg-sidebar">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="The Next" className="h-6" />
          <h1 className="text-sm font-semibold text-sidebar-foreground">The Next</h1>
        </div>
        <div className="flex items-center gap-2">
          {!connected && <span className="text-[10px] text-destructive">离线</span>}
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex shrink-0 gap-1 px-3 py-2">
        {FILTERS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cx(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
              filter === key
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent',
            )}
          >
            <Icon className="size-3.5" />
            {label}
            <span className="text-[10px] opacity-70">{counts[key]}</span>
          </button>
        ))}
      </div>

      {/* Quick add */}
      <div className="shrink-0 border-b border-sidebar-border">
        <QuickAdd onAdd={onAdd} disabled={!connected} />
      </div>

      {/* Task list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {filteredTasks.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <ListTodo className="size-8 opacity-30" />
              <p className="text-xs">{filter === 'all' ? '还没有任务' : '没有匹配的任务'}</p>
            </div>
          )}
          {filteredTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              runtime={runtimes[task.id]}
              selected={task.id === selectedId}
              onSelect={onSelect}
              onRun={onRun}
              onDelete={onDelete}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
