import type { AgentConfig } from '@the-next/core'
import { useEffect, useRef } from 'react'
import { ChatInput } from '@/components/ChatInput'
import { ChatMessage } from '@/components/ChatMessage'
import { StatusIndicator } from '@/components/StatusIndicator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAgent } from '@/hooks/useAgent'

const agentConfig: AgentConfig = {
  model: import.meta.env.VITE_MINIMAX_MODEL ?? 'MiniMax-M2.7',
  apiKey: import.meta.env.VITE_MINIMAX_API_KEY ?? '',
  baseURL: import.meta.env.VITE_MINIMAX_BASE_URL ?? 'https://api.minimaxi.com/v1',
}

/**
 * 应用根组件 — The Next 聊天界面
 *
 * 三段式布局：
 * 1. 顶部 Header — logo + 应用名 + 状态指示
 * 2. 中间消息区 — 可滚动的消息列表 + 流式输出
 * 3. 底部输入区 — 文本输入 + 发送按钮
 */
function App() {
  const { messages, agentState, streamingText, sendMessage, abort } = useAgent(agentConfig)
  const viewportRef = useRef<HTMLDivElement>(null)

  /* 消息或流式文本更新时，平滑滚动到底部 */
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages 和 streamingText 变化时需要触发滚动
  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages, streamingText])

  const isProcessing =
    agentState === 'thinking' || agentState === 'streaming' || agentState === 'tool_calling'

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="The Next" className="h-8" />
        </div>
        <StatusIndicator state={agentState} />
      </header>

      {/* area */}
      <ScrollArea className="flex-1" viewportRef={viewportRef}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">

          {messages.length === 0 && !streamingText && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-32 text-muted-foreground">
              <img src="/logo.svg" alt="The Next" className="h-16 opacity-40" />
              <p className="text-lg">有什么我可以帮你的？</p>
            </div>
          )}

          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

          {streamingText && (
            <ChatMessage
              message={{
                type: 'assistant',
                id: '__streaming__',
                content: streamingText,
                timestamp: Date.now(),
              }}
              isStreaming
            />
          )}
        </div>
      </ScrollArea>

      {/* input */}
      <div className="shrink-0 border-t border-border bg-card p-4">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            onSend={sendMessage}
            onAbort={abort}
            disabled={isProcessing}
            isProcessing={isProcessing}
          />
        </div>
      </div>
    </div>
  )
}

export default App
