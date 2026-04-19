import type { Task, TaskEvent } from '@the-next/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { discoverServer, getHttpBase, getWsUrl, resetDiscovery } from '@/lib/server'
import { useTaskRuntime } from './useTaskRuntime'

type TaskMessage = {
  id: string
  role: string
  content: string
  timestamp: number
}

/**
 * useTasks —— 任务列表 + WebSocket 桥接 + 运行时事件分发。
 *
 * 职责:
 * 1. REST 拉取 / 创建 / 删除 / 触发执行
 * 2. WS 接收 task_event,把 status 变更落到 tasks state,
 *    把 agent 事件转发给 useTaskRuntime(让 UI 看到执行实况)
 *
 * useTaskRuntime 维护的 runtime 状态独立于 tasks 列表本身,
 * 二者通过 taskId 关联,职责清晰。
 */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)

  const { runtimes, applyEvent, reset, getRuntime } = useTaskRuntime()

  // 用 ref 持有 applyEvent,避免把它塞到 useEffect 依赖里导致 WS 重连
  const applyEventRef = useRef(applyEvent)
  applyEventRef.current = applyEvent

  const fetchTasks = useCallback(async () => {
    try {
      await discoverServer()
      const res = await fetch(`${getHttpBase()}/api/tasks`)
      const data: Task[] = await res.json()
      setTasks(data)
    } catch {
      // server not ready
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    function connectWs() {
      const ws = new WebSocket(getWsUrl())

      ws.onopen = () => {
        if (cancelled) {
          ws.close()
          return
        }
        wsRef.current = ws
      }

      ws.onmessage = (e) => {
        if (cancelled) return
        const msg = JSON.parse(e.data)

        if (msg.type === 'ready') {
          setConnected(true)
          return
        }

        if (msg.type === 'task_event') {
          const event: TaskEvent = msg.event

          // ── 1. 转发到运行时(无论事件类型,让 runtime 自己识别) ──
          applyEventRef.current(event)

          // ── 2. 处理 task 列表上的状态变更 ──
          if (event.type === 'task_status_changed') {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === event.taskId ? { ...t, status: event.status, updatedAt: Date.now() } : t,
              ),
            )
          }
        }
      }

      ws.onclose = () => {
        if (cancelled) return
        wsRef.current = null
        setConnected(false)
        resetDiscovery()
        setTimeout(reconnect, 2000)
      }

      ws.onerror = () => ws.close()
    }

    function reconnect() {
      if (cancelled) return
      discoverServer()
        .then(() => {
          connectWs()
          fetchTasks()
        })
        .catch(() => {
          if (!cancelled) setTimeout(reconnect, 2000)
        })
    }

    discoverServer()
      .then(() => {
        if (!cancelled) {
          connectWs()
          fetchTasks()
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false)
          setTimeout(reconnect, 2000)
        }
      })

    return () => {
      cancelled = true
      wsRef.current?.close()
    }
  }, [fetchTasks])

  const createTask = useCallback(
    async (description: string, schedule?: { runAt?: number; cron?: string }) => {
      await discoverServer()
      const res = await fetch(`${getHttpBase()}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, schedule }),
      })
      const task: Task = await res.json()
      setTasks((prev) => [task, ...prev])
      return task
    },
    [],
  )

  // 触发执行前先重置该任务的 runtime 状态,避免上一轮残留(toolCalls / turns)
  const runTask = useCallback(
    async (taskId: string) => {
      reset(taskId)
      await discoverServer()
      await fetch(`${getHttpBase()}/api/tasks/${taskId}/run`, { method: 'POST' })
    },
    [reset],
  )

  const deleteTask = useCallback(
    async (taskId: string) => {
      await discoverServer()
      await fetch(`${getHttpBase()}/api/tasks/${taskId}`, { method: 'DELETE' })
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      reset(taskId)
    },
    [reset],
  )

  const updateTask = useCallback(
    async (taskId: string, patch: Partial<Pick<Task, 'title' | 'status'>>) => {
      await discoverServer()
      const res = await fetch(`${getHttpBase()}/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const updated: Task = await res.json()
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)))
    },
    [],
  )

  const fetchMessages = useCallback(async (taskId: string): Promise<TaskMessage[]> => {
    await discoverServer()
    const res = await fetch(`${getHttpBase()}/api/tasks/${taskId}/messages`)
    return res.json()
  }, [])

  const refreshTask = useCallback(async (taskId: string) => {
    await discoverServer()
    const res = await fetch(`${getHttpBase()}/api/tasks/${taskId}`)
    const task: Task = await res.json()
    setTasks((prev) => prev.map((t) => (t.id === taskId ? task : t)))
    return task
  }, [])

  return {
    tasks,
    connected,
    loading,
    createTask,
    runTask,
    deleteTask,
    updateTask,
    fetchMessages,
    refreshTask,
    /** 所有任务的运行时状态 Map(taskId → runtime) */
    runtimes,
    /** 取单个任务的运行时(不存在则返回空 state) */
    getRuntime,
  }
}
