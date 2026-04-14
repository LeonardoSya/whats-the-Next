import { bashTool } from './packages/bash'
import { fileReadTool } from './packages/file-read'
import { fileWriteTool } from './packages/file-write'
import { grepTool } from './packages/grep'
import type { ToolDefinition } from './types'

// 工具包注册入口
const builtinTools: readonly ToolDefinition[] = [fileReadTool, fileWriteTool, bashTool, grepTool]

/**
 * 获取所有可用的默认工具
 */
export function getDefaultTools(): readonly ToolDefinition[] {
  return builtinTools
}
