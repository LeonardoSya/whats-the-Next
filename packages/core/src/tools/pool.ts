import { McpManager } from '../mcp/manager'
import { getDefaultTools } from './registry'
import type { ToolDefinition } from './types'

/**
 * Merge tool definitions with built-ins taking precedence over later sources.
 */
export const mergeToolDefinitions = (
  builtInTools: readonly ToolDefinition[],
  mcpTools: readonly ToolDefinition[],
): readonly ToolDefinition[] => {
  const merged: ToolDefinition[] = []
  const seen = new Set<string>()

  for (const tool of [...builtInTools, ...mcpTools]) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    merged.push(tool)
  }

  return merged
}

/**
 * Assemble the full tool pool consumed by the agent.
 */
export const assembleToolDefinitions = (
  builtInTools: readonly ToolDefinition[] = getDefaultTools(),
  mcpTools: readonly ToolDefinition[] = McpManager.getToolDefinitions(),
): readonly ToolDefinition[] => mergeToolDefinitions(builtInTools, mcpTools)
