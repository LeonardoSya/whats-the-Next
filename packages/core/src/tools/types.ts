import { zodSchema, type ToolSet } from 'ai'
import type { z } from 'zod'

/**
 * 自定义工具定义接口
 *
 * 包装 AI SDK 的 Tool 类型，预留 permission / progress 等扩展字段。
 * 通过 `toSDKTools` 转换为 AI SDK 可消费的格式。
 */
export type ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> = {
  readonly name: string
  readonly description: string
  readonly parameters: TInput
  readonly execute: (args: z.infer<TInput>) => Promise<unknown>
}

/**
 * 将自定义 ToolDefinition[] 转换为 AI SDK streamText 的 tools 参数格式
 *
 * @returns ToolSet — AI SDK 要求的 Record<toolName, Tool>
 */
export function toSDKTools(defs: readonly ToolDefinition[]): ToolSet {
  const tools: ToolSet = {}
  for (const d of defs) {
    tools[d.name] = {
      description: d.description,
      inputSchema: zodSchema(d.parameters),
      execute: d.execute,
    } as unknown as ToolSet[string]
  }
  return tools
}
