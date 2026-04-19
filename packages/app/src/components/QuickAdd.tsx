import { Plus } from 'lucide-react'
import { type KeyboardEvent, useCallback, useState } from 'react'
import { Input } from '@/components/ui/input'

type QuickAddProps = {
  readonly onAdd: (description: string) => void
  readonly disabled?: boolean
}

export function QuickAdd({ onAdd, disabled }: QuickAddProps) {
  const [value, setValue] = useState('')

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onAdd(trimmed)
    setValue('')
  }, [value, disabled, onAdd])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Plus className="size-4 shrink-0 text-primary" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="描述一个任务... (Enter 创建)"
        disabled={disabled}
        className="h-8 border-none bg-transparent shadow-none focus-visible:ring-0 text-sm placeholder:text-muted-foreground/60"
      />
    </div>
  )
}
