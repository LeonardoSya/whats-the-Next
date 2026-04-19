import type { AgentEvent } from '../types/event'

/**
 * 任务类型枚举。
 *
 * TaskRouter 根据用户自然语言描述推断出任务类型，
 * 再由 ToolKit 注册表自动匹配对应的工具集。
 */
export type TaskType =
  | 'doc_edit'
  | 'spreadsheet'
  | 'pdf_process'
  | 'presentation'
  | 'file_organize'
  | 'data_transform'
  | 'general'

export type TaskStatus = 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled'

export type TaskSchedule = {
  readonly runAt?: number
  readonly cron?: string
  readonly reminder?: number
}

export type TaskResult = {
  readonly summary: string
  readonly outputFiles?: readonly string[]
  readonly error?: string
}

export type Task = {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly taskType: TaskType
  readonly toolkitIds: readonly string[]
  readonly status: TaskStatus
  readonly schedule?: TaskSchedule
  readonly result?: TaskResult
  readonly createdAt: number
  readonly updatedAt: number
  readonly completedAt?: number
}

/**
 * Task 引擎产出的事件。
 *
 * 包装了底层 AgentEvent，附加 taskId 以便多任务并行时区分来源。
 */
export type TaskEvent =
  | { readonly type: 'task_status_changed'; readonly taskId: string; readonly status: TaskStatus }
  | { readonly type: 'task_agent_event'; readonly taskId: string; readonly event: AgentEvent }
  | { readonly type: 'task_result'; readonly taskId: string; readonly result: TaskResult }

export const createTask = (
  params: Pick<Task, 'title' | 'description' | 'taskType' | 'toolkitIds'> &
    Partial<Pick<Task, 'schedule'>>,
): Task => ({
  id: crypto.randomUUID(),
  status: params.schedule ? 'scheduled' : 'pending',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...params,
})
