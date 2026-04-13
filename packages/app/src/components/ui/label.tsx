import type { LabelHTMLAttributes } from 'react'
import { cx } from '@/lib/utils'

/** Label 组件 — shadcn/ui 风格标签 */
function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // biome-ignore lint: false positivebiome
    <label
      className={cx(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
