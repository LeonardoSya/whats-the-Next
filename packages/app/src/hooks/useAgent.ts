import type { AgentState, Message } from '@the-next/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { discoverServer, getWsUrl, resetDiscovery } from '@/lib/server'

type ServerMessage = {
  type: 'ready' | 'event' | 'error'
  id?: string
  event?: {
    type: 'state_change' | 'text_delta' | 'message_complete' | 'error'
    state?: AgentState
    delta?: string
    message?: Message
    error?: string
  }
  error?: string
}

export function useAgent() {
  const [messages, setMessages] = useState<Message[]>([])
  const [agentState, setAgentState] = useState<AgentState>('idle')
  const [streamingText, setStreamingText] = useState('')
  const [connected, setConnected] = useState(false)

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

  return {
    messages,
    agentState,
    streamingText,
    connected,
    sendMessage,
    abort,
  }
}
