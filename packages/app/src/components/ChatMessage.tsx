import type { Message } from '@the-next/core'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cx } from '@/lib/utils'

/** 聊天消息组件属性 */
type ChatMessageProps = {
  /** 要渲染的消息对象 */
  readonly message: Message
  /** 是否正在流式输出中（显示光标动画） */
  readonly isStreaming?: boolean
}

/**
 * 聊天消息气泡组件
 *
 * - 用户消息：靠右，主题绿色背景
 * - 助手消息：靠左，白色卡片背景 + logo 头像
 * - 流式输出时显示闪烁光标
 */
export function ChatMessage({ message, isStreaming = false }: ChatMessageProps) {
  const isUser = message.type === 'user'

  return (
    <div className={cx('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* 头像 */}
      <Avatar
        className={cx('mt-1 shrink-0', isUser ? 'bg-primary' : 'bg-card border border-border')}
      >
        {isUser ? (
          <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
            你
          </AvatarFallback>
        ) : (
          <>
            <AvatarImage src="/logo.svg" alt="AI" className="p-1" />
            <AvatarFallback className="bg-card text-foreground text-xs">AI</AvatarFallback>
          </>
        )}
      </Avatar>

      {/* 消息气泡 */}
      <div
        className={cx(
          'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-card text-card-foreground border border-border rounded-tl-sm',
        )}
      >
        <p className="whitespace-pre-wrap break-words">
          {message.content}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current" />
          )}
        </p>
      </div>
    </div>
  )
}
