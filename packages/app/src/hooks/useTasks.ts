import type { Task, TaskEvent } from '@the-next/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { discoverServer, getHttpBase, getWsUrl, resetDiscovery } from '@/lib/server'

type TaskMessage = {
  id: string
  role: string
  content: string
  timestamp: number
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)

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

  const runTask = useCallback(async (taskId: string) => {
    await discoverServer()
    await fetch(`${getHttpBase()}/api/tasks/${taskId}/run`, { method: 'POST' })
  }, [])

  const deleteTask = useCallback(async (taskId: string) => {
    await discoverServer()
    await fetch(`${getHttpBase()}/api/tasks/${taskId}`, { method: 'DELETE' })
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }, [])

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
  }
}
