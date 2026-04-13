import { z } from 'zod'
import type { ToolDefinition } from '../types'

const parameters = z.object({
  timezone: z.string().optional().describe('IANA 时区标识，如 Asia/Shanghai'),
})

export const currentTimeTool: ToolDefinition<typeof parameters> = {
  name: 'get_current_time',
  description: '获取当前系统时间和日期',
  parameters,
  execute: async ({ timezone }) => {
    const tz = timezone ?? 'Asia/Shanghai'
    const now = new Date()
    return {
      iso: now.toISOString(),
      local: now.toLocaleString('zh-CN', { timeZone: tz }),
      timezone: tz,
    }
  },
}
