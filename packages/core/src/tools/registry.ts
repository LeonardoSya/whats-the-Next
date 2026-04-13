import type { ToolDefinition } from './types'
import { currentTimeTool } from './demo/currentTime'

const builtinTools: readonly ToolDefinition[] = [currentTimeTool]

/**
 * 获取所有可用的默认工具
 */
export function getDefaultTools(): readonly ToolDefinition[] {
  return builtinTools
}
