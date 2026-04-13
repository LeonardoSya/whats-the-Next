import type { TextareaHTMLAttributes } from 'react'
import { cx } from '@/lib/utils'

/** Textarea 组件属性 */
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

/** 文本域组件 — 多行文本输入 */
function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cx(
        'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export type { TextareaProps }
export { Textarea }
