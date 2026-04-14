import { dirname } from 'node:path'
import { z } from 'zod'
import type { ToolDefinition } from '../types'

const parameters = z.object({
  file_path: z.string().describe('要写入的文件的绝对路径（必须是绝对路径）'),
  content: z.string().describe('要写入的文件内容'),
})

export const fileWriteTool: ToolDefinition<typeof parameters> = {
  name: 'file_write',
  description:
    'Write content to a file. Creates parent directories if needed. Overwrites existing files.',
  parameters,
  riskLevel: 'write',
  async execute({ file_path, content }) {
    const file = Bun.file(file_path)
    const existed = await file.exists()

    const dir = dirname(file_path)
    await Bun.$`mkdir -p ${dir}`.quiet()

    const bytes = await Bun.write(file_path, content)

    return {
      status: existed ? 'updated' : 'created',
      path: file_path,
      bytes,
    }
  },
}
