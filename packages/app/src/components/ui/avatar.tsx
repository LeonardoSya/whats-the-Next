import * as AvatarPrimitive from '@radix-ui/react-avatar'
import type { ComponentPropsWithoutRef } from 'react'
import { cx } from '@/lib/utils'

/** 头像容器组件 */
function Avatar({ className, ...props }: ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      className={cx('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  )
}

/** 头像图片组件 */
function AvatarImage({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image className={cx('aspect-square size-full', className)} {...props} />
}

/** 头像占位符组件（图片加载失败时显示） */
function AvatarFallback({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cx('flex size-full items-center justify-center rounded-full bg-muted', className)}
      {...props}
    />
  )
}

export { Avatar, AvatarFallback, AvatarImage }
