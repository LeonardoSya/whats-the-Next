import type { ToolSet } from 'ai'
import type { AgentConfig } from '../types/config'
import type { Message } from '../types/message'

/**
 * Agent 运行时上下文，作为 runAgent 的唯一入参。
 *
 * 收敛所有 runAgent 需要的外部依赖，避免参数列表膨胀。
 */
export type AgentContext = {
  readonly config: AgentConfig
  readonly messages: readonly Message[]
  readonly tools?: ToolSet
}
