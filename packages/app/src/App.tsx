import { MessageCircle, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AgentRuntimeBar } from '@/components/AgentRuntimeBar'
import { ChatInput } from '@/components/ChatInput'
import { PermissionDialog } from '@/components/PermissionDialog'
import { SettingsPanel } from '@/components/SettingsPanel'
import { StatusIndicator } from '@/components/StatusIndicator'
import { TurnTimeline } from '@/components/TurnTimeline'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { type Session, useAgent } from '@/hooks/useAgent'
import { EMPTY_AGENT_RUNTIME } from '@/hooks/useAgentRuntime'

/**
 * SessionBlock —— 一次 user query 触发的完整对话单元。
 *
 * 视觉:用户气泡 → TurnTimeline(本次 agent 的思考/工具/回答),
 * 多个 session 在 ScrollArea 里依序堆叠,滚动就是会话历史。
 */
function SessionBlock({ session }: { session: Session }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm whitespace-pre-wrap wrap-break-word">
          {session.userContent}
        </div>
      </div>
      <div className="pl-2">
        <TurnTimeline runtime={session.runtime} />
      </div>
    </div>
  )
}

/**
 * 单轮对话 Agent 的根组件。
 *
 * 布局(自上而下):
 * - 顶栏:连接状态 + agent 状态指示 + 设置入口
 * - AgentRuntimeBar:当前 session 的实时 turn/token/工具统计
 * - 消息流:每个 user query 对应一个 SessionBlock(气泡 + TurnTimeline)
 * - 输入框:Enter 发送 / 处理中可中止
 * - 权限弹窗:dangerous 工具执行前的审批
 */
function App() {
  const [showSettings, setShowSettings] = useState(false)
  const {
    sessions,
    currentSession,
    agentState,
    connected,
    pendingPermission,
    sendMessage,
    abort,
    respondPermission,
  } = useAgent()

  const isProcessing =
    agentState === 'thinking' || agentState === 'streaming' || agentState === 'tool_calling'

  const viewportRef = useRef<HTMLDivElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 这些 state 是 scroll trigger
  useEffect(() => {
    const el = viewportRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sessions, currentSession])

  const isEmpty = sessions.length === 0 && !currentSession

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block size-2 rounded-full ${
                connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
              }`}
            />
            <span className="text-xs text-muted-foreground">
              {connected ? '已连接' : '连接中…'}
            </span>
          </div>
          <div className="h-3 w-px bg-border" />
          <StatusIndicator state={agentState} />
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowSettings(true)}
          className="size-8"
        >
          <Settings className="size-4" />
        </Button>
      </header>

      {/* Runtime bar —— 当前 session 的实时统计(没在跑时自动隐藏) */}
      <AgentRuntimeBar runtime={currentSession?.runtime ?? EMPTY_AGENT_RUNTIME} />

      {/* 消息流 */}
      <ScrollArea viewportRef={viewportRef} className="flex-1 min-h-0">
        <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
          {isEmpty && (
            <div className="mt-24 flex flex-col items-center gap-3 text-center text-muted-foreground">
              <div className="rounded-2xl bg-muted/50 p-6">
                <MessageCircle className="size-10 opacity-40" />
              </div>
              <p className="text-base font-medium text-foreground/60">开始一段对话</p>
              <p className="text-sm">输入消息后,agent 会按 turn 实时展示思考和工具调用</p>
            </div>
          )}

          {sessions.map((s) => (
            <SessionBlock key={s.id} session={s} />
          ))}

          {currentSession && <SessionBlock session={currentSession} />}
        </div>
      </ScrollArea>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-border bg-background/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            onSend={sendMessage}
            onAbort={abort}
            disabled={!connected}
            isProcessing={isProcessing}
          />
        </div>
      </div>

      <SettingsPanel
        open={showSettings}
        onOpenChange={setShowSettings}
        onSaved={() => setShowSettings(false)}
      />

      <PermissionDialog request={pendingPermission} onRespond={respondPermission} />
    </div>
  )
}

export default App
