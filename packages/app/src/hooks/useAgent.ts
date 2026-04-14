import type { AgentState, Message, RiskLevel } from '@the-next/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { discoverServer, getWsUrl, resetDiscovery } from '@/lib/server'

type ToolCallInfo = {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  result?: unknown
  status: 'calling' | 'done' | 'error'
  error?: string
}

export type PermissionRequest = {
  permissionId: string
  toolName: string
  args: Record<string, unknown>
  riskLevel: RiskLevel
}

type ServerMessage = {
  type: 'ready' | 'event' | 'error'
  id?: string
  event?: {
    type:
      | 'state_change'
      | 'text_delta'
      | 'message_complete'
      | 'error'
      | 'tool_call'
      | 'tool_result'
      | 'tool_error'
      | 'permission_request'
    state?: AgentState
    delta?: string
    message?: Message
    error?: string
    toolCallId?: string
    toolName?: string
    args?: Record<string, unknown>
    result?: unknown
    permissionId?: string
    riskLevel?: RiskLevel
  }
  error?: string
}

export function useAgent() {
  const [messages, setMessages] = useState<Message[]>([])
  const [agentState, setAgentState] = useState<AgentState>('idle')
  const [streamingText, setStreamingText] = useState('')
  const [connected, setConnected] = useState(false)
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([])
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const streamBufferRef = useRef('')
  const rafIdRef = useRef(0)

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
        const msg: ServerMessage = JSON.parse(e.data)

        if (msg.type === 'ready') {
          setConnected(true)
          return
        }

        if (requestIdRef.current && msg.id !== requestIdRef.current) return

        if (msg.type === 'error') {
          if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current)
            rafIdRef.current = 0
          }
          streamBufferRef.current = ''
          setStreamingText('')
          setAgentState('error')
          return
        }

        if (msg.type === 'event' && msg.event) {
          const event = msg.event

          switch (event.type) {
            case 'state_change':
              if (event.state) setAgentState(event.state)
              break

            case 'text_delta':
              if (event.delta) {
                streamBufferRef.current += event.delta
                if (!rafIdRef.current) {
                  rafIdRef.current = requestAnimationFrame(() => {
                    setStreamingText(streamBufferRef.current)
                    rafIdRef.current = 0
                  })
                }
              }
              break

            case 'tool_call': {
              const tcId = event.toolCallId
              const tcName = event.toolName
              if (tcId && tcName) {
                setToolCalls((prev) => [
                  ...prev,
                  {
                    toolCallId: tcId,
                    toolName: tcName,
                    args: event.args ?? {},
                    status: 'calling',
                  },
                ])
              }
              break
            }

            case 'tool_result': {
              const trId = event.toolCallId
              if (trId) {
                setToolCalls((prev) =>
                  prev.map((tc) =>
                    tc.toolCallId === trId
                      ? { ...tc, result: event.result, status: 'done' as const }
                      : tc,
                  ),
                )
              }
              break
            }

            case 'tool_error': {
              const teId = event.toolCallId
              if (teId) {
                setToolCalls((prev) =>
                  prev.map((tc) =>
                    tc.toolCallId === teId
                      ? { ...tc, error: event.error, status: 'error' as const }
                      : tc,
                  ),
                )
              }
              break
            }

            case 'permission_request': {
              const pId = event.permissionId
              if (pId && event.toolName && event.riskLevel) {
                setPendingPermission({
                  permissionId: pId,
                  toolName: event.toolName,
                  args: event.args ?? {},
                  riskLevel: event.riskLevel,
                })
              }
              break
            }

            case 'message_complete':
              {
                const completedMessage = event.message
                if (completedMessage) {
                  if (rafIdRef.current) {
                    cancelAnimationFrame(rafIdRef.current)
                    rafIdRef.current = 0
                  }
                  streamBufferRef.current = ''
                  setMessages((prev) => [...prev, completedMessage])
                  setStreamingText('')
                }
              }
              break

            case 'error':
              if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current)
                rafIdRef.current = 0
              }
              streamBufferRef.current = ''
              setStreamingText('')
              setAgentState('error')
              break
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
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const sendMessage = useCallback(
    (content: string) => {
      if (agentState !== 'idle' && agentState !== 'done' && agentState !== 'error') return
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return

      streamBufferRef.current = ''
      setToolCalls([])

      const userMessage: Message = {
        type: 'user',
        id: crypto.randomUUID(),
        content,
        timestamp: Date.now(),
      }
      const updatedMessages = [...messagesRef.current, userMessage]
      setMessages(updatedMessages)
      setStreamingText('')

      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId

      wsRef.current.send(
        JSON.stringify({
          type: 'chat',
          id: requestId,
          messages: updatedMessages,
        }),
      )
    },
    [agentState],
  )

  const abort = useCallback(() => {
    if (requestIdRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'abort', id: requestIdRef.current }))
    }
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = 0
    }
    streamBufferRef.current = ''
    setAgentState('idle')
    setStreamingText('')
  }, [])

  const respondPermission = useCallback((permissionId: string, approved: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'permission_response', permissionId, approved }))
    }
    setPendingPermission(null)
  }, [])

  return {
    messages,
    agentState,
    streamingText,
    connected,
    toolCalls,
    pendingPermission,
    sendMessage,
    abort,
    respondPermission,
  }
}
