import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 日志级别。
 * debug: 详细的调试信息（system prompt 全文、tool 参数等）
 * info:  正常的 workflow 节点（任务创建、路由结果、执行开始/完成）
 * warn:  非致命的异常（重试、fallback）
 * error: 致命错误（执行失败、LLM 调用失败）
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Workflow 阶段。用于在日志中标记当前处于 pipeline 的哪个环节。
 */
export type LogPhase =
  | 'route' // TaskRouter 分类
  | 'toolkit' // ToolKit 解析
  | 'execute' // TaskExecutor 总控
  | 'agent_loop' // runAgent 循环
  | 'tool_call' // 单次工具调用
  | 'tool_result' // 工具返回
  | 'llm_request' // LLM API 请求
  | 'llm_response' // LLM API 响应
  | 'schedule' // 调度器
  | 'permission' // 权限审批
  | 'system' // 系统级（启动、配置等）

/**
 * 单条日志记录。每条 JSONL 行对应一个 LogEntry。
 */
export type LogEntry = {
  readonly timestamp: string
  readonly level: LogLevel
  readonly phase: LogPhase
  readonly taskId: string
  readonly message: string
  readonly data?: Record<string, unknown>
  readonly durationMs?: number
}

const LOG_DIR = join(homedir(), '.the-next', 'logs')

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
}

function logFilePath(taskId: string): string {
  return join(LOG_DIR, `${taskId}.jsonl`)
}

/**
 * TaskLogger — 以 Task 为维度的结构化 JSONL 日志。
 *
 * 每个 Task 一个 .jsonl 文件，存储在 ~/.the-next/logs/{taskId}.jsonl。
 * 支持多次执行追加（cron 任务的每轮执行都追加到同一个文件）。
 *
 * 设计参考 Claude Code 的 sessionStorage.ts JSONL 追加写入模式。
 */
export class TaskLogger {
  private taskId: string
  private filePath: string
  private startTimes = new Map<string, number>()

  constructor(taskId: string) {
    ensureLogDir()
    this.taskId = taskId
    this.filePath = logFilePath(taskId)
  }

  private write(entry: Omit<LogEntry, 'timestamp' | 'taskId'>): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      taskId: this.taskId,
      ...entry,
    }
    const line = `${JSON.stringify(logEntry)}\n`
    try {
      appendFileSync(this.filePath, line, 'utf-8')
    } catch {
      /* best-effort, 不阻塞主流程 */
    }
  }

  /** 记录一条分阶段日志 */
  log(level: LogLevel, phase: LogPhase, message: string, data?: Record<string, unknown>): void {
    this.write({ level, phase, message, data })
  }

  debug(phase: LogPhase, message: string, data?: Record<string, unknown>): void {
    this.write({ level: 'debug', phase, message, data })
  }

  info(phase: LogPhase, message: string, data?: Record<string, unknown>): void {
    this.write({ level: 'info', phase, message, data })
  }

  warn(phase: LogPhase, message: string, data?: Record<string, unknown>): void {
    this.write({ level: 'warn', phase, message, data })
  }

  error(phase: LogPhase, message: string, data?: Record<string, unknown>): void {
    this.write({ level: 'error', phase, message, data })
  }

  /** 开始计时（用 label 标识） */
  startTimer(label: string): void {
    this.startTimes.set(label, performance.now())
  }

  /** 结束计时并写入日志 */
  endTimer(
    label: string,
    level: LogLevel,
    phase: LogPhase,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const start = this.startTimes.get(label)
    const durationMs = start !== undefined ? Math.round(performance.now() - start) : undefined
    this.startTimes.delete(label)
    this.write({ level, phase, message, data, durationMs })
  }

  /** 在执行开始时写一个分隔线，方便区分多次执行 */
  markExecutionStart(): void {
    this.info('execute', '═══ Execution started ═══', {
      startedAt: new Date().toISOString(),
    })
  }
}

/**
 * 读取某个任务的完整日志。
 * 支持按 level 和 phase 过滤，支持分页。
 */
export async function readTaskLogs(
  taskId: string,
  filter?: {
    level?: LogLevel
    phase?: LogPhase
    limit?: number
    offset?: number
  },
): Promise<{ entries: LogEntry[]; total: number }> {
  const filePath = logFilePath(taskId)
  const file = Bun.file(filePath)

  if (!(await file.exists())) return { entries: [], total: 0 }

  const text = await file.text()
  const lines = text.trim().split('\n').filter(Boolean)

  let entries: LogEntry[] = lines
    .map((line) => {
      try {
        return JSON.parse(line) as LogEntry
      } catch {
        return null
      }
    })
    .filter((e): e is LogEntry => e !== null)

  if (filter?.level) {
    entries = entries.filter((e) => e.level === filter.level)
  }
  if (filter?.phase) {
    entries = entries.filter((e) => e.phase === filter.phase)
  }

  const total = entries.length
  const offset = filter?.offset ?? 0
  const limit = filter?.limit ?? 500

  return {
    entries: entries.slice(offset, offset + limit),
    total,
  }
}

/**
 * 删除任务日志文件。
 */
export async function deleteTaskLogs(taskId: string): Promise<void> {
  const filePath = logFilePath(taskId)
  try {
    await Bun.$`rm -f ${filePath}`.quiet()
  } catch {
    /* best-effort */
  }
}

/**
 * 获取日志目录路径（供外部展示）。
 */
export function getLogDir(): string {
  return LOG_DIR
}
