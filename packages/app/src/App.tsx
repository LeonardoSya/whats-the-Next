import { Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ChatInput } from '@/components/ChatInput'
import { ChatMessage } from '@/components/ChatMessage'
import { PermissionDialog } from '@/components/PermissionDialog'
import { SettingsPanel } from '@/components/SettingsPanel'
import { StatusIndicator } from '@/components/StatusIndicator'
import { ToolCallCard } from '@/components/ToolCallCard'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAgent } from '@/hooks/useAgent'
import { discoverServer, getHttpBase } from '@/lib/server'

/**
 * 应用根组件 — The Next 聊天界面
 *
 * 三段式布局：
 * 1. 顶部 Header — logo + 应用名 + 状态指示 + 设置
 * 2. 中间消息区 — 可滚动的消息列表 + 流式输出
 * 3. 底部输入区 — 文本输入 + 发送按钮
 */
function App() {
  const [hasConfig, setHasConfig] = useState<boolean | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const {
    messages,
    agentState,
    streamingText,
    connected,
    toolCalls,
    pendingPermission,
    sendMessage,
    abort,
    respondPermission,
  } = useAgent()
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const checkConfig = async () => {
      try {
        await discoverServer()
        const res = await fetch(`${getHttpBase()}/api/config`)
        const data = await res.json()
        setHasConfig(data.configured === true)
        if (!data.configured) setShowSettings(true)
      } catch {
        setHasConfig(false)
        setShowSettings(true)
      }
    }
    checkConfig()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on content change
  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, streamingText])

  const isProcessing =
    agentState === 'thinking' || agentState === 'streaming' || agentState === 'tool_calling'

  const handleConfigSaved = async () => {
    try {
      await discoverServer()
      const res = await fetch(`${getHttpBase()}/api/config`)
      const data = await res.json()
      setHasConfig(data.configured === true)
    } catch {
      // ignore
    }
    setShowSettings(false)
  }

  if (hasConfig === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="The Next" className="h-8" />
        </div>
        <div className="flex items-center gap-3">
          {!connected && <span className="text-xs text-destructive">服务未连接</span>}
          <StatusIndicator state={agentState} />
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="设置"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
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

          {toolCalls.map((tc) => (
            <ToolCallCard key={tc.toolCallId} toolCall={tc} />
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
            disabled={isProcessing || !hasConfig || !connected}
            isProcessing={isProcessing}
          />
          {!hasConfig && (
            <p className="mt-2 text-center text-sm text-muted-foreground">
              请先
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => setShowSettings(true)}
              >
                配置 API Key
              </button>
              后开始对话
            </p>
          )}
        </div>
      </div>

      {/* 设置面板 */}
      <SettingsPanel
        open={showSettings}
        onOpenChange={setShowSettings}
        onSaved={handleConfigSaved}
      />

      {/* 权限确认弹窗 */}
      <PermissionDialog request={pendingPermission} onRespond={respondPermission} />
    </div>
  )
}

export default App
