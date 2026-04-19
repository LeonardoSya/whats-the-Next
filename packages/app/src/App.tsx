import { ListTodo } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { SettingsPanel } from '@/components/SettingsPanel'
import { TaskDetailView } from '@/components/TaskDetailView'
import { TaskListSidebar } from '@/components/TaskListSidebar'
import { useTasks } from '@/hooks/useTasks'

/**
 * 应用根组件 — Task-Driven Agent
 *
 * 双栏布局（Apple Reminders 风格）：
 * 1. 左侧 Sidebar — 任务列表 + 快速添加 + 过滤器
 * 2. 右侧 Main — 任务详情（执行结果 + 对话日志）
 */
function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const {
    tasks,
    connected,
    loading,
    createTask,
    runTask,
    deleteTask,
    fetchMessages,
    refreshTask,
    runtimes,
    getRuntime,
  } = useTasks()

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  )

  const selectedRuntime = useMemo(
    () => (selectedTaskId ? getRuntime(selectedTaskId) : null),
    [selectedTaskId, getRuntime],
  )

  const handleAdd = useCallback(
    async (description: string) => {
      const task = await createTask(description)
      setSelectedTaskId(task.id)
    },
    [createTask],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteTask(id)
      if (selectedTaskId === id) setSelectedTaskId(null)
    },
    [deleteTask, selectedTaskId],
  )

  const handleConfigSaved = useCallback(() => {
    setShowSettings(false)
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <TaskListSidebar
        tasks={tasks}
        runtimes={runtimes}
        selectedId={selectedTaskId}
        onSelect={setSelectedTaskId}
        onAdd={handleAdd}
        onRun={runTask}
        onDelete={handleDelete}
        onOpenSettings={() => setShowSettings(true)}
        connected={connected}
      />

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {selectedTask && selectedRuntime ? (
          <TaskDetailView
            task={selectedTask}
            runtime={selectedRuntime}
            onRun={runTask}
            onRefresh={refreshTask}
            fetchMessages={fetchMessages}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="rounded-2xl bg-muted/50 p-6">
              <ListTodo className="size-12 opacity-30" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-foreground/60">选择一个任务查看详情</p>
              <p className="mt-1 text-sm">在左侧输入框中描述任务，系统会自动匹配工具并执行</p>
            </div>
          </div>
        )}
      </main>

      {/* Settings */}
      <SettingsPanel
        open={showSettings}
        onOpenChange={setShowSettings}
        onSaved={handleConfigSaved}
      />
    </div>
  )
}

export default App
