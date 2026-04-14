import { type ToolSet, zodSchema } from 'ai'
import type { z } from 'zod'
import type { ApprovalCallback } from './permission'
import { withPermissionGate } from './permission'

/**
 * tool风险等级
 *
 * - safe: 只读操作，自动放行（file_read、grep）
 * - write: 有副作用但常规的写操作，自动放行（file_write、常规 bash）
 * - dangerous: 高危操作，须用户确认（rm -rf、sudo 等）
 */
export type RiskLevel = 'safe' | 'write' | 'dangerous'

/**
 * 自定义工具定义接口
 *
 * 包装 AI SDK 的 Tool 类型，预留 permission / progress 等扩展字段。
 * 通过 `toSDKTools` 转换为 AI SDK 可消费的格式。
 */
export type ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> = {
  readonly name: string
  // 模型看到description后自己决定要不要调用该工具
  readonly description: string
  // 定义模型能填的表单，类型通过tool里const parameters = z.object()自动推断
  readonly parameters: TInput
  readonly execute: (args: z.infer<TInput>) => Promise<unknown>
  readonly riskLevel?: RiskLevel | ((args: z.infer<TInput>) => RiskLevel)
}

/**
 * 将自定义 ToolDefinition[] 转换为 AI SDK streamText 的 tools 参数格式。
 * 当提供 approve 回调时，会用权限门控包装 dangerous 工具的 execute。
 *
 * @returns ToolSet — AI SDK 要求的 Record<toolName, Tool>
 */
export const toSDKTools = (
  definitions: readonly ToolDefinition[],
  approve?: ApprovalCallback,
): ToolSet => {
  const tools: ToolSet = {}
  for (const d of definitions) {
    const execute = approve ? withPermissionGate(d, approve) : d.execute
    tools[d.name] = {
      description: d.description,
      inputSchema: zodSchema(d.parameters),
      execute,
    } as ToolSet[string]
  }
  return tools
}
