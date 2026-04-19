import { generateObject } from 'ai'
import { z } from 'zod'
import { createMiniMaxModel } from '../llm/client'
import type { AgentConfig } from '../types/config'
import { TaskLogger } from './logger'
import type { TaskType } from './model'

type RouteResult = {
  readonly taskType: TaskType
  readonly title: string
}

type PatternRule = {
  readonly pattern: RegExp
  readonly type: TaskType
  readonly titlePrefix: string
}

const TASK_TYPES: readonly TaskType[] = [
  'doc_edit',
  'spreadsheet',
  'pdf_process',
  'presentation',
  'file_organize',
  'data_transform',
  'general',
]

const RULES: readonly PatternRule[] = [
  {
    pattern: /\b(docx?|word|文档编辑|修改文档|编辑文档)\b/i,
    type: 'doc_edit',
    titlePrefix: '文档',
  },
  { pattern: /\b(xlsx?|excel|表格|spreadsheet|csv)\b/i, type: 'spreadsheet', titlePrefix: '表格' },
  { pattern: /\b(pdf|转换.*pdf|pdf.*提取)\b/i, type: 'pdf_process', titlePrefix: 'PDF' },
  {
    pattern: /\b(pptx?|ppt|演示|slides?|幻灯片)\b/i,
    type: 'presentation',
    titlePrefix: '演示文稿',
  },
  {
    pattern: /\b(整理文件|归档|文件分类|重命名|移动文件)\b/i,
    type: 'file_organize',
    titlePrefix: '文件整理',
  },
  {
    pattern: /\b(数据转换|格式转换|json.*csv|csv.*json|数据清洗)\b/i,
    type: 'data_transform',
    titlePrefix: '数据转换',
  },
]

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

/**
 * 规则匹配（快速路径，不消耗 token）。
 */
function matchByRules(description: string): RouteResult | null {
  for (const rule of RULES) {
    if (rule.pattern.test(description)) {
      return {
        taskType: rule.type,
        title: `${rule.titlePrefix}: ${truncate(description, 40)}`,
      }
    }
  }
  return null
}

const classificationSchema = z.object({
  taskType: z.enum(TASK_TYPES as unknown as [string, ...string[]]).describe('推断的任务类型'),
  title: z.string().max(60).describe('简短的任务标题（中文，不超过 20 字）'),
})

/**
 * LLM 分类（慢路径，规则匹配失败时使用）。
 */
async function classifyWithLLM(description: string, config: AgentConfig): Promise<RouteResult> {
  try {
    const model = createMiniMaxModel(config)
    const { object } = await generateObject({
      model,
      schema: classificationSchema,
      prompt: `根据以下任务描述，判断它属于哪种任务类型，并生成一个简短的中文标题。

任务类型说明：
- doc_edit: Word/docx 文档的创建、编辑、格式调整
- spreadsheet: Excel/CSV 表格的读取、处理、生成
- pdf_process: PDF 文件的文本提取、转换
- presentation: PPT/演示文稿的创建和编辑
- file_organize: 文件的整理、归档、批量重命名
- data_transform: 数据格式转换、清洗
- general: 以上都不符合的通用任务

任务描述：${description}`,
      maxOutputTokens: 200,
    })

    return {
      taskType: object.taskType as TaskType,
      title: object.title,
    }
  } catch {
    return {
      taskType: 'general',
      title: truncate(description, 50),
    }
  }
}

/**
 * 同步路由：仅规则匹配，无 LLM 调用。
 * 用于不需要/无法调用 LLM 的场景。
 */
export function routeTask(description: string): RouteResult {
  const matched = matchByRules(description)
  if (matched) return matched
  return { taskType: 'general', title: truncate(description, 50) }
}

/**
 * 异步路由：规则优先，fallback 到 LLM 分类。
 * 需要 AgentConfig 来创建 LLM 客户端。
 */
export async function routeTaskAsync(
  description: string,
  config: AgentConfig,
): Promise<RouteResult> {
  const matched = matchByRules(description)
  if (matched) return matched
  return classifyWithLLM(description, config)
}

/**
 * 将路由结果写入已创建的 task 日志。
 * 在 task 创建后调用，补记路由决策过程。
 */
export function logRouteDecision(
  taskId: string,
  description: string,
  result: RouteResult,
  method: 'rule' | 'llm',
): void {
  const log = new TaskLogger(taskId)
  log.info('route', `Task routed via ${method}`, {
    input: description,
    taskType: result.taskType,
    title: result.title,
    method,
  })
}
