import type { RiskLevel, ToolDefinition } from './types'

/**
 * 审批回调：发送权限请求到前端，返回 Promise<boolean>
 */
export type ApprovalCallback = (request: {
  permissionId: string
  toolName: string
  args: Record<string, unknown>
  riskLevel: RiskLevel
}) => Promise<boolean>

function resolveRisk(tool: ToolDefinition, args: unknown): RiskLevel {
  if (typeof tool.riskLevel === 'function') return tool.riskLevel(args)
  return tool.riskLevel ?? 'write'
}

/**
 * 包装工具的 execute 函数，在执行前根据风险等级决定是否需要用户审批。
 *
 * - safe: 直接执行
 * - write: 直接执行（MVP 阶段自动放行）
 * - dangerous: 必须等待用户确认
 */
export const withPermissionGate = (
  tool: ToolDefinition,
  approve: ApprovalCallback,
): ((args: unknown) => Promise<unknown>) => {
  return async (args: unknown) => {
    const risk = resolveRisk(tool, args)

    if (risk === 'dangerous') {
      const permissionId = crypto.randomUUID()
      const approved = await approve({
        permissionId,
        toolName: tool.name,
        args: args as Record<string, unknown>,
        riskLevel: risk,
      })

      if (!approved) {
        throw new Error(`User denied permission to execute ${tool.name}`)
      }
    }

    return tool.execute(args)
  }
}
