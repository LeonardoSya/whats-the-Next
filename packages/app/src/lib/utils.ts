import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 合并 Tailwind CSS 类名，处理冲突和条件类 */
export function cx(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
