import { type Schema, type ToolSet, zodSchema } from 'ai'
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
 * 工具执行运行时选项 —— 由 SDK 在调 execute 时透传进来。
 */
export type ToolExecuteOptions = {
  readonly signal?: AbortSignal
  readonly toolCallId?: string
}

/**
 * 自定义工具定义接口
 *
 * 包装 AI SDK 的 Tool 类型，预留 permission / progress 等扩展字段。
 * 通过 `toSDKTools` 转换为 AI SDK 可消费的格式。
 *
 * `parameters` 接受两种形态:
 * - Zod schema(内置工具):入参类型自动推断为 `z.infer<TInput>`
 * - AI SDK Schema(MCP 等 JSON Schema 来源):入参类型退化为 `unknown`
 */
export type ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> = {
  readonly name: string
  // 模型看到description后自己决定要不要调用该工具
  readonly description: string
  // 定义模型能填的表单，类型通过tool里const parameters = z.object()自动推断
  readonly parameters: TInput | Schema<unknown>
  readonly execute: (args: z.infer<TInput>, options?: ToolExecuteOptions) => Promise<unknown>
  readonly riskLevel?: RiskLevel | ((args: z.infer<TInput>) => RiskLevel)
}

const isZodSchema = (s: unknown): s is z.ZodTypeAny =>
  typeof s === 'object' && s !== null && '_def' in s

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
    const wrapped = approve ? withPermissionGate(d, approve) : d.execute
    tools[d.name] = {
      description: d.description,
      inputSchema: isZodSchema(d.parameters) ? zodSchema(d.parameters) : d.parameters,
      // 把 AI SDK 的 ToolExecutionOptions 收窄成自家的 ToolExecuteOptions,
      // 给工具(包括 MCP)透传 abort signal,让取消能真正生效。
      execute: (args: unknown, sdkOptions?: { abortSignal?: AbortSignal; toolCallId?: string }) =>
        wrapped(args as never, {
          signal: sdkOptions?.abortSignal,
          toolCallId: sdkOptions?.toolCallId,
        }),
    } as ToolSet[string]
  }
  return tools
}
