import { Send, Square } from 'lucide-react'
import { type KeyboardEvent, useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/** 聊天输入框组件属性 */
type ChatInputProps = {
  /** 发送消息的回调函数 */
  readonly onSend: (content: string) => void
  /** 中止生成的回调函数 */
  readonly onAbort?: () => void
  /** 是否禁用输入 */
  readonly disabled?: boolean
  /** Agent 是否正在处理中（显示停止按钮） */
  readonly isProcessing?: boolean
}

/**
 * 聊天输入框组件
 *
 * - Enter 发送消息
 * - Shift+Enter 换行
 * - Agent 处理中显示停止按钮
 * - 使用 shadcn/ui Textarea + Button 组件
 */
export function ChatInput({
  onSend,
  onAbort,
  disabled = false,
  isProcessing = false,
}: ChatInputProps) {
  const [input, setInput] = useState('')

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setInput('')
  }, [input, disabled, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        disabled={disabled}
        rows={1}
        className="max-h-32 min-h-10 resize-none rounded-xl border-border bg-background"
      />
      {isProcessing ? (
        <Button
          variant="destructive"
          size="icon"
          onClick={onAbort}
          className="shrink-0 rounded-xl"
          type="button"
        >
          <Square className="size-4" />
        </Button>
      ) : (
        <Button
          onClick={handleSend}
          disabled={!input.trim()}
          className="shrink-0 rounded-xl"
          size="icon"
          type="button"
        >
          <Send className="size-4" />
        </Button>
      )}
    </div>
  )
}
