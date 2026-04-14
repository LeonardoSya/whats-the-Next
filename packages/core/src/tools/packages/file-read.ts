import { z } from 'zod'
import type { ToolDefinition } from '../types'

const MAX_LINES = 2000

const parameters = z.object({
  file_path: z.string().describe('要读取的文件的绝对路径'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('开始读取的行号（1-based）。文件过大时使用'),
  limit: z.number().int().positive().optional().describe('要读取的行数。文件过大时使用'),
})

function addLineNumbers(lines: string[], startLine: number): string {
  return lines
    .map((line, i) => {
      const num = String(startLine + i).padStart(6, ' ')
      return `${num}|${line}`
    })
    .join('\n')
}

export const fileReadTool: ToolDefinition<typeof parameters> = {
  name: 'file_read',
  description: 'Read a file from the local filesystem. Returns file content with line numbers.',
  parameters,
  riskLevel: 'safe',
  async execute({ file_path, offset, limit }) {
    const file = Bun.file(file_path)

    if (!(await file.exists())) {
      throw new Error(`File not found: ${file_path}`)
    }

    const text = await file.text()
    const allLines = text.split('\n')
    const totalLines = allLines.length

    const startLine = offset ? Math.min(offset, totalLines) : 1
    const startIndex = startLine - 1
    const effectiveLimit = limit ?? MAX_LINES
    const endIndex = Math.min(startIndex + effectiveLimit, totalLines)
    const lines = allLines.slice(startIndex, endIndex)
    const truncated = endIndex < totalLines && !limit

    return {
      content: addLineNumbers(lines, startLine),
      totalLines,
      linesRead: lines.length,
      ...(truncated && {
        truncatedAt: endIndex,
        hint: `File has ${totalLines} lines, showing ${startLine}-${endIndex}. Use offset/limit to read more.`,
      }),
    }
  },
}
