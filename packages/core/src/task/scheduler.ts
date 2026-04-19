import { TaskLogger } from './logger'
import type { Task } from './model'
import type { TaskStore } from './store'

type SchedulerCallback = (taskId: string) => Promise<void>

/**
 * 简易 cron 表达式解析：minute hour dayOfMonth month dayOfWeek
 * 支持 * 和固定数字，不支持 range / step（MVP 足够）。
 * 返回下一次触发的 Unix 毫秒时间戳。
 */
function nextCronTime(cron: string, after: Date = new Date()): number {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${cron}`)

  const [minStr, hourStr, domStr, monStr, dowStr] = parts as [
    string,
    string,
    string,
    string,
    string,
  ]

  const matches = (field: string, value: number): boolean =>
    field === '*' || Number.parseInt(field, 10) === value

  const base = new Date(after)
  base.setSeconds(0, 0)
  base.setMinutes(base.getMinutes() + 1)

  // 最多扫描 366 天 * 24 小时 * 60 分钟 ≈ 527040 分钟
  const MAX_SCAN = 527_040
  for (let i = 0; i < MAX_SCAN; i++) {
    const candidate = new Date(base.getTime() + i * 60_000)
    if (
      matches(minStr, candidate.getMinutes()) &&
      matches(hourStr, candidate.getHours()) &&
      matches(domStr, candidate.getDate()) &&
      matches(monStr, candidate.getMonth() + 1) &&
      matches(dowStr, candidate.getDay())
    ) {
      return candidate.getTime()
    }
  }

  throw new Error(`No matching time found within one year for cron: ${cron}`)
}

/**
 * TaskScheduler — 后台定时器，管理 scheduled 任务的触发。
 *
 * 启动时从 TaskStore 加载所有 status='scheduled' 的任务，
 * 为每个有 schedule 的任务注册定时器。
 * 到时间时回调 onTrigger（由 server 注入，负责执行 + WS 推送）。
 */
export class TaskScheduler {
  private timers = new Map<string, Timer>()
  private store: TaskStore
  private onTrigger: SchedulerCallback

  constructor(store: TaskStore, onTrigger: SchedulerCallback) {
    this.store = store
    this.onTrigger = onTrigger
  }

  async init(): Promise<void> {
    const tasks = this.store.listScheduled()
    for (const task of tasks) {
      this.schedule(task)
    }
    console.log(`TaskScheduler: loaded ${tasks.length} scheduled tasks`)
  }

  schedule(task: Task): void {
    if (!task.schedule) return

    this.cancel(task.id)
    const log = new TaskLogger(task.id)

    if (task.schedule.runAt) {
      const delay = task.schedule.runAt - Date.now()
      if (delay <= 0) {
        log.info('schedule', 'Scheduled task firing immediately (past due)', {
          runAt: task.schedule.runAt,
        })
        this.fire(task.id)
        return
      }
      log.info('schedule', 'Task scheduled (one-time)', {
        runAt: task.schedule.runAt,
        delayMs: delay,
        firesAt: new Date(task.schedule.runAt).toISOString(),
      })
      const timer = setTimeout(() => this.fire(task.id), delay)
      this.timers.set(task.id, timer)
      return
    }

    if (task.schedule.cron) {
      log.info('schedule', 'Task scheduled (cron)', { cron: task.schedule.cron })
      this.scheduleCron(task.id, task.schedule.cron)
    }
  }

  private scheduleCron(taskId: string, cron: string): void {
    try {
      const nextTime = nextCronTime(cron)
      const delay = nextTime - Date.now()
      const timer = setTimeout(() => {
        this.fire(taskId)
        // 触发后重新调度下一次
        const task = this.store.getById(taskId)
        if (task?.schedule?.cron && task.status !== 'cancelled') {
          this.store.update(taskId, { status: 'scheduled' })
          this.scheduleCron(taskId, task.schedule.cron)
        }
      }, delay)
      this.timers.set(taskId, timer)
    } catch (e) {
      console.error(`TaskScheduler: failed to schedule cron for task ${taskId}:`, e)
    }
  }

  cancel(taskId: string): void {
    const timer = this.timers.get(taskId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(taskId)
    }
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private async fire(taskId: string): Promise<void> {
    this.timers.delete(taskId)
    const log = new TaskLogger(taskId)
    log.info('schedule', 'Scheduler firing task')
    try {
      await this.onTrigger(taskId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('schedule', 'Scheduler trigger failed', { error: msg })
      console.error(`TaskScheduler: error executing task ${taskId}:`, e)
    }
  }

  get scheduledCount(): number {
    return this.timers.size
  }
}
