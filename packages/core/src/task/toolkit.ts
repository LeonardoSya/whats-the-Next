import { bashTool } from '../tools/packages/bash'
import { docxReadTool } from '../tools/packages/docx-read'
import { docxWriteTool } from '../tools/packages/docx-write'
import { fileReadTool } from '../tools/packages/file-read'
import { fileWriteTool } from '../tools/packages/file-write'
import { grepTool } from '../tools/packages/grep'
import { pdfExtractTool } from '../tools/packages/pdf-extract'
import { xlsxReadTool } from '../tools/packages/xlsx-read'
import { xlsxWriteTool } from '../tools/packages/xlsx-write'
import type { ToolDefinition } from '../tools/types'
import type { TaskType } from './model'

/**
 * ToolKit — 按领域聚合的工具集。
 *
 * 与 Claude Code 的 resolveAgentTools 黑白名单不同，
 * 这里用 TaskType → ToolKit 的正向映射，让工具编排对用户透明。
 */
export type ToolKit = {
  readonly id: string
  readonly name: string
  readonly taskTypes: readonly TaskType[]
  readonly tools: readonly ToolDefinition[]
  /** 注入到 system prompt 的领域特定指令 */
  readonly systemPromptAddon?: string
}

const filesystemKit: ToolKit = {
  id: 'filesystem',
  name: '文件系统工具集',
  taskTypes: [
    'doc_edit',
    'spreadsheet',
    'pdf_process',
    'file_organize',
    'data_transform',
    'general',
  ],
  tools: [fileReadTool, fileWriteTool, bashTool, grepTool],
}

const docxKit: ToolKit = {
  id: 'docx',
  name: 'Word 文档工具集',
  taskTypes: ['doc_edit'],
  tools: [docxReadTool, docxWriteTool],
  systemPromptAddon:
    '你正在处理 Word 文档任务。使用 docx_read 读取文档内容，docx_write 创建或修改文档。需要 python-docx: pip3 install python-docx',
}

const spreadsheetKit: ToolKit = {
  id: 'spreadsheet',
  name: '表格工具集',
  taskTypes: ['spreadsheet'],
  tools: [xlsxReadTool, xlsxWriteTool],
  systemPromptAddon:
    '你正在处理 Excel/CSV 表格任务。使用 xlsx_read 读取表格，xlsx_write 创建表格。需要 openpyxl: pip3 install openpyxl',
}

const pdfKit: ToolKit = {
  id: 'pdf',
  name: 'PDF 工具集',
  taskTypes: ['pdf_process'],
  tools: [pdfExtractTool],
  systemPromptAddon:
    '你正在处理 PDF 文档任务。使用 pdf_extract 提取文本内容。需要 pypdf: pip3 install pypdf',
}

const presentationKit: ToolKit = {
  id: 'presentation',
  name: '演示文稿工具集',
  taskTypes: ['presentation'],
  tools: [],
  systemPromptAddon:
    '你正在处理演示文稿任务。使用 bash 工具结合 python-pptx 来操作 PPT 文件。需要: pip3 install python-pptx',
}

/**
 * 全局 ToolKit 注册表。
 * Phase 2 的办公文档工具实现后，各 kit 的 tools 数组会填充实际工具。
 * MVP 阶段所有任务类型都至少拥有 filesystem kit。
 */
const registry: readonly ToolKit[] = [
  filesystemKit,
  docxKit,
  spreadsheetKit,
  pdfKit,
  presentationKit,
]

/**
 * 根据 TaskType 解析出所有匹配的 ToolKit。
 * 保证每种任务类型至少返回 filesystem kit。
 */
export function resolveToolkits(taskType: TaskType): readonly ToolKit[] {
  const matched = registry.filter((kit) => kit.taskTypes.includes(taskType))
  if (matched.length === 0) return [filesystemKit]
  return matched
}

/**
 * 将多个 ToolKit 的工具合并去重。
 */
export function mergeToolkitTools(toolkits: readonly ToolKit[]): readonly ToolDefinition[] {
  const seen = new Set<string>()
  const merged: ToolDefinition[] = []
  for (const kit of toolkits) {
    for (const tool of kit.tools) {
      if (seen.has(tool.name)) continue
      seen.add(tool.name)
      merged.push(tool)
    }
  }
  return merged
}

/**
 * 收集所有 ToolKit 的 systemPromptAddon，拼接为额外指令。
 */
export function collectSystemPromptAddons(toolkits: readonly ToolKit[]): string {
  return toolkits
    .map((kit) => kit.systemPromptAddon)
    .filter(Boolean)
    .join('\n\n')
}

export function getToolkitIds(toolkits: readonly ToolKit[]): string[] {
  return toolkits.map((kit) => kit.id)
}
