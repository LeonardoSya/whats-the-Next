import type { Task } from '@the-next/core'
import { Bug, Calendar, Clock, FileText, MessageSquare, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cx } from '@/lib/utils'
import { TaskLogViewer } from './TaskLogViewer'
import { TaskStatusBadge } from './TaskStatusBadge'
import { TaskTypeBadge } from './TaskTypeBadge'

type TaskMessage = {
  id: string
  role: string
  content: string
  timestamp: number
}

type TaskDetailViewProps = {
  readonly task: Task
  readonly onRun: (id: string) => void
  readonly onRefresh: (id: string) => Promise<Task>
  readonly fetchMessages: (id: string) => Promise<TaskMessage[]>
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type DetailTab = 'messages' | 'logs'

export function TaskDetailView({ task, onRun, onRefresh, fetchMessages }: TaskDetailViewProps) {
  const [messages, setMessages] = useState<TaskMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [activeTab, setActiveTab] = useState<DetailTab>('messages')

  const canRun =
    task.status === 'pending' || task.status === 'failed' || task.status === 'scheduled'
  const isRunning = task.status === 'running'

  const loadMessages = useCallback(async () => {
    setLoadingMessages(true)
    try {
      const msgs = await fetchMessages(task.id)
      setMessages(msgs)
    } catch {
      // ignore
    } finally {
      setLoadingMessages(false)
    }
  }, [task.id, fetchMessages])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-foreground truncate">{task.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <TaskTypeBadge taskType={task.taskType} />
              <TaskStatusBadge status={task.status} />
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="size-3" />
                {formatDateTime(task.createdAt)}
              </span>
              {task.completedAt && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3" />
                  完成于 {formatDateTime(task.completedAt)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 ml-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onRefresh(task.id)
                loadMessages()
              }}
              title="刷新"
            >
              <RotateCcw className="size-4" />
            </Button>
            {canRun && (
              <Button size="sm" onClick={() => onRun(task.id)}>
                <Play className="size-4" />
                执行
              </Button>
            )}
            {isRunning && (
              <Button size="sm" variant="secondary" disabled>
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                执行中...
              </Button>
            )}
          </div>
        </div>

        {/* Description */}
        {task.description && (
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{task.description}</p>
        )}
      </div>

      {/* Result */}
      {task.result && (
        <div className="shrink-0 border-b border-border px-6 py-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            执行结果
          </h3>
          {task.result.error ? (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{task.result.error}</div>
          ) : (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 whitespace-pre-wrap">
              {task.result.summary}
            </div>
          )}
          {task.result.outputFiles && task.result.outputFiles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {task.result.outputFiles.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-mono"
                >
                  <FileText className="size-3" />
                  {f.split('/').pop()}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="shrink-0 flex items-center gap-1 border-b border-border px-6 py-0">
          <button
            type="button"
            onClick={() => setActiveTab('messages')}
            className={cx(
              'flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
              activeTab === 'messages'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <MessageSquare className="size-3.5" />
            对话记录
            {messages.length > 0 && (
              <span className="text-[10px] opacity-70">({messages.length})</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={cx(
              'flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
              activeTab === 'logs'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Bug className="size-3.5" />
            Workflow 日志
          </button>
        </div>

        {/* Messages tab */}
        {activeTab === 'messages' && (
          <ScrollArea className="flex-1">
            <div className="px-6 py-3 space-y-3">
              {loadingMessages && (
                <p className="text-xs text-muted-foreground animate-pulse">加载中...</p>
              )}
              {!loadingMessages && messages.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                  <FileText className="size-8 opacity-30" />
                  <p className="text-xs">尚未执行，点击"执行"按钮开始</p>
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cx(
                    'rounded-lg px-3 py-2 text-sm',
                    msg.role === 'user'
                      ? 'bg-primary/10 text-foreground'
                      : msg.role === 'assistant'
                        ? 'bg-card border border-border text-foreground'
                        : 'bg-muted text-muted-foreground text-xs font-mono',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">
                      {msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : msg.role}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDateTime(msg.timestamp)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap wrap-break-word">{msg.content}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Logs tab */}
        {activeTab === 'logs' && <TaskLogViewer taskId={task.id} />}
      </div>
    </div>
  )
}
