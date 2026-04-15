import type { ToolSet } from 'ai'
import type { SandboxConfig } from '../sandbox/manager'
import type { AgentConfig } from '../types/config'
import type { Message } from '../types/message'

/**
 * Agent 运行时上下文，作为 runAgent 的唯一入参。
 *
 * 收敛所有 runAgent 需要的外部依赖，避免参数列表膨胀。
 * 工具的注册、格式转换、权限包装等全部在外层完成，
 * loop 只消费最终可用的 tools。
 */
export type AgentContext = {
  readonly config: AgentConfig
  readonly messages: readonly Message[]
  readonly tools?: ToolSet
  readonly sandbox?: SandboxConfig
}
