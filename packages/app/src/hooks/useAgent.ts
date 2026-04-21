import type {
  AgentState,
  ClientMessage,
  Message,
  PermissionRequestEvent,
  ServerMessage,
} from '@the-next/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { discoverServer, getWsUrl, resetDiscovery } from '@/lib/server'
import { type AgentRuntimeState, applyAgentEvent, EMPTY_AGENT_RUNTIME } from './useAgentRuntime'

/**
 * 等待用户审批的权限请求 —— 即 PermissionRequestEvent 去掉 type 字段。
 * 跟 core 的事件类型同步,字段任何变化都会编译失败。
 */
export type PermissionRequest = Omit<PermissionRequestEvent, 'type'>

/**
 * 一次 user query 触发的"user 消息 + 一串 agent turns"作为一个 Session。
 *
 * UI 会按 Session 分组渲染:每个 user 气泡下面跟着 agent 本次完整的 TurnTimeline。
 * Session 一旦被新的 user query 顶下去,runtime 就不再更新(归档为只读快照)。
 */
export type Session = {
  readonly id: string
  readonly userContent: string
  readonly runtime: AgentRuntimeState
}

/**
 * useAgent —— 前端 agent runtime 的唯一入口。
 *
 * 职责:
 * 1. 维护 WebSocket 连接(自动重连 + 端口发现)
 * 2. 把 AgentEvent 流喂给 runtime reducer,按 Session 分组归档
 * 3. 管理顶层状态:agentState / pendingPermission / connected
 * 4. 管理给 LLM 发的 message 历史(每次 sendMessage 带上所有历史 + 新 user msg)
 *
 * 对外暴露:
 * - sessions / currentSession:UI 按 session 渲染对话流
 * - sendMessage / abort / respondPermission:用户交互
 * - agentState / pendingPermission / connected:顶层指示
 */
export function useAgent() {
  // 已归档的 session(每个都是只读快照)
  const [sessions, setSessions] = useState<Session[]>([])
  // 当前正在跑的 session(未 archived)
  const [currentSession, setCurrentSession] = useState<Session | null>(null)
  // 顶层状态
  const [agentState, setAgentState] = useState<AgentState>('idle')
  const [connected, setConnected] = useState(false)
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const requestIdRef = useRef<string | null>(null)
  // 给 LLM 发消息时需要完整历史 —— 用 ref 不触发 re-render
  const messagesRef = useRef<Message[]>([])
  // currentSession 的同步镜像 —— sendMessage 里需要拿"最新值"做归档,
  // 但 setState updater 里有副作用会被 StrictMode 双调用,所以走 ref。
  const currentSessionRef = useRef<Session | null>(null)
  useEffect(() => {
    currentSessionRef.current = currentSession
  }, [currentSession])

  /** 类型安全的 send —— ClientMessage 联合穷尽,协议变化会编译报错。 */
  const sendClient = useCallback((msg: ClientMessage): boolean => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(msg))
    return true
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
        // ServerMessage 是 EventMessage | ReadyMessage | ErrorMessage 的辨别联合,
        // JSON.parse 后的运行时校验由 server 协议合同保证(双方共用 core 类型)。
        const msg = JSON.parse(e.data) as ServerMessage

        if (msg.type === 'ready') {
          setConnected(true)
          return
        }

        // ready 之外的消息都有 id (EventMessage / ErrorMessage),
        // 按 requestId 过滤:不同 chat 请求间的事件不串台
        if (requestIdRef.current && msg.id !== requestIdRef.current) return

        if (msg.type === 'error') {
          setAgentState('error')
          // 也落到 runtime.lastError 让 AgentRuntimeBar 能展示
          setCurrentSession((prev) =>
            prev ? { ...prev, runtime: { ...prev.runtime, lastError: msg.error } } : prev,
          )
          return
        }

        // 这里 msg.type === 'event',TS narrow 出 EventMessage,event 是 AgentEvent 联合
        const event = msg.event

        // 顶层状态更新(不走 reducer)
        if (event.type === 'state_change') {
          setAgentState(event.state)
        } else if (event.type === 'permission_request') {
          setPendingPermission({
            permissionId: event.permissionId,
            toolName: event.toolName,
            args: event.args,
            riskLevel: event.riskLevel,
          })
        } else if (event.type === 'message_complete') {
          // 把 assistant message 追加到历史(下次 sendMessage 时要发回给 LLM)
          messagesRef.current = [...messagesRef.current, event.message]
        }

        // runtime reducer —— 同一份 event 既走顶层副作用又喂给 reducer
        setCurrentSession((prev) => {
          if (!prev) return prev
          const nextRuntime = applyAgentEvent(prev.runtime, event)
          if (nextRuntime === prev.runtime) return prev
          return { ...prev, runtime: nextRuntime }
        })
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
        .then(() => connectWs())
        .catch(() => {
          if (!cancelled) setTimeout(reconnect, 2000)
        })
    }

    discoverServer()
      .then(() => {
        if (!cancelled) connectWs()
      })
      .catch(() => {
        if (!cancelled) setTimeout(reconnect, 2000)
      })

    return () => {
      cancelled = true
      wsRef.current?.close()
    }
  }, [])

  const sendMessage = useCallback(
    (content: string) => {
      if (agentState !== 'idle' && agentState !== 'done' && agentState !== 'error') return

      const userMessage: Message = {
        type: 'user',
        id: crypto.randomUUID(),
        content,
        timestamp: Date.now(),
      }
      messagesRef.current = [...messagesRef.current, userMessage]

      const requestId = crypto.randomUUID()

      const sent = sendClient({
        type: 'chat',
        id: requestId,
        messages: messagesRef.current,
      })
      if (!sent) return

      // 归档前一个 session —— 从 ref 读最新值,setSessions 用 pure updater(StrictMode 安全)。
      // ⚠️ 不要在 setCurrentSession 的 updater 里调 setSessions,那样 StrictMode 双调用 updater
      //    会导致 setSessions 被重复执行,前一个 session 在归档里出现两次。
      const prev = currentSessionRef.current
      if (prev) setSessions((archive) => [...archive, prev])

      requestIdRef.current = requestId
      const newSession: Session = {
        id: userMessage.id,
        userContent: content,
        runtime: EMPTY_AGENT_RUNTIME,
      }
      // 同步更新 ref + state,确保 ref 不依赖 useEffect 的延迟同步
      currentSessionRef.current = newSession
      setCurrentSession(newSession)
    },
    [agentState, sendClient],
  )

  const abort = useCallback(() => {
    const id = requestIdRef.current
    if (id) sendClient({ type: 'abort', id })
    setAgentState('idle')
  }, [sendClient])

  const respondPermission = useCallback(
    (permissionId: string, approved: boolean) => {
      sendClient({ type: 'permission_response', permissionId, approved })
      setPendingPermission(null)
    },
    [sendClient],
  )

  return {
    sessions,
    currentSession,
    agentState,
    connected,
    pendingPermission,
    sendMessage,
    abort,
    respondPermission,
  }
}
