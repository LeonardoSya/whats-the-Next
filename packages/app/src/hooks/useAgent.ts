import {
  type AgentConfig,
  type AgentState,
  createUserMessage,
  type Message,
  runAgent,
} from '@the-next/core'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Agent React Hook — 管理消息列表、运行状态和流式输出。
 *
 * 消费 `runAgent()` 返回的 AsyncGenerator，通过 `for await` 迭代事件流。
 * 设计参考：Claude Code 的 REPL.tsx `onQueryEvent` 模式。
 *
 * 流式输出使用 ref + requestAnimationFrame 模式：
 * - text_delta 事件写入 ref（无渲染开销）
 * - RAF 回调以 ~60fps 刷新 state → 实现逐字打字机效果
 *
 * @param config - Agent 配置（模型、API 密钥等）
 * @returns 消息列表、状态、流式文本、发送/中止方法
 */
export function useAgent(config: AgentConfig) {
  const [messages, setMessages] = useState<Message[]>([])
  const [agentState, setAgentState] = useState<AgentState>('idle')
  const [streamingText, setStreamingText] = useState('')
  const abortRef = useRef(false)

  /** 流式文本缓冲区 — 累积所有 delta，RAF 时刷新到 state */
  const streamBufferRef = useRef('')
  const rafIdRef = useRef(0)

  /** 清理 RAF，防止组件卸载后残留更新 */
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [])

  const sendMessage = useCallback(
    async (content: string) => {
      // 仅在空闲、完成或出错状态下允许发送
      if (agentState !== 'idle' && agentState !== 'done' && agentState !== 'error') {
        return
      }

      abortRef.current = false
      streamBufferRef.current = ''

      // 不可变追加用户消息
      const userMessage = createUserMessage(content)
      const updatedMessages = [...messages, userMessage]
      setMessages(updatedMessages)
      setStreamingText('')

      // 消费异步生成器（Claude Code 的 `for await` 模式）
      const generator = runAgent(config, updatedMessages)

      try {
        for await (const event of generator) {
          if (abortRef.current) break

          switch (event.type) {
            case 'state_change':
              setAgentState(event.state)
              break

            case 'text_delta':
              // 写入缓冲区（零渲染开销），由 RAF 按帧刷新
              streamBufferRef.current += event.delta
              if (!rafIdRef.current) {
                rafIdRef.current = requestAnimationFrame(() => {
                  setStreamingText(streamBufferRef.current)
                  rafIdRef.current = 0
                })
              }
              break

            case 'message_complete':
              // 确保 RAF 残留被清理
              if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current)
                rafIdRef.current = 0
              }
              streamBufferRef.current = ''
              // 不可变追加助手消息
              setMessages((prev) => [...prev, event.message])
              setStreamingText('')
              break

            case 'error':
              streamBufferRef.current = ''
              setStreamingText('')
              break
          }
        }
      } catch (_error) {
        setAgentState('error')
        streamBufferRef.current = ''
        setStreamingText('')
      }
    },
    [config, messages, agentState],
  )

  const abort = useCallback(() => {
    abortRef.current = true
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
    sendMessage,
    abort,
  }
}
