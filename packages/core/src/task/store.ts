import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Message } from '../types/message'
import type { Task, TaskResult, TaskSchedule, TaskStatus, TaskType } from './model'

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    task_type TEXT NOT NULL DEFAULT 'general',
    toolkit_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    schedule TEXT,
    result TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS task_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_call_id TEXT,
    tool_name TEXT,
    args TEXT,
    result TEXT,
    timestamp INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_task_messages_task_id ON task_messages(task_id)`,
]

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    taskType: row.task_type as TaskType,
    toolkitIds: JSON.parse(row.toolkit_ids as string) as string[],
    status: row.status as TaskStatus,
    schedule: row.schedule ? (JSON.parse(row.schedule as string) as TaskSchedule) : undefined,
    result: row.result ? (JSON.parse(row.result as string) as TaskResult) : undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    completedAt: (row.completed_at as number) ?? undefined,
  }
}

function messageFromRow(row: Record<string, unknown>): Message {
  const role = row.role as string
  const base = {
    id: String(row.id),
    content: row.content as string,
    timestamp: row.timestamp as number,
  }

  switch (role) {
    case 'tool_call':
      return {
        ...base,
        type: 'tool_call',
        toolCallId: row.tool_call_id as string,
        toolName: row.tool_name as string,
        args: JSON.parse(row.args as string) as Record<string, unknown>,
      }
    case 'tool_result':
      return {
        ...base,
        type: 'tool_result',
        toolCallId: row.tool_call_id as string,
        toolName: row.tool_name as string,
        result: JSON.parse(row.result as string) as unknown,
      }
    default:
      return { ...base, type: role as 'user' | 'assistant' | 'system' }
  }
}

export class TaskStore {
  private db: Database

  constructor(dbPath: string) {
    ensureDir(dbPath)
    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    for (const sql of MIGRATIONS) this.db.exec(sql)
  }

  create(task: Task): Task {
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, description, task_type, toolkit_ids, status, schedule, created_at, updated_at)
         VALUES ($id, $title, $description, $taskType, $toolkitIds, $status, $schedule, $createdAt, $updatedAt)`,
      )
      .run({
        $id: task.id,
        $title: task.title,
        $description: task.description,
        $taskType: task.taskType,
        $toolkitIds: JSON.stringify(task.toolkitIds),
        $status: task.status,
        $schedule: task.schedule ? JSON.stringify(task.schedule) : null,
        $createdAt: task.createdAt,
        $updatedAt: task.updatedAt,
      })
    return task
  }

  update(
    id: string,
    patch: Partial<
      Pick<Task, 'title' | 'description' | 'status' | 'result' | 'schedule' | 'completedAt'>
    >,
  ): Task | null {
    const sets: string[] = []
    const params: Record<string, unknown> = { $id: id, $updatedAt: Date.now() }

    if (patch.title !== undefined) {
      sets.push('title = $title')
      params.$title = patch.title
    }
    if (patch.description !== undefined) {
      sets.push('description = $description')
      params.$description = patch.description
    }
    if (patch.status !== undefined) {
      sets.push('status = $status')
      params.$status = patch.status
    }
    if (patch.result !== undefined) {
      sets.push('result = $result')
      params.$result = JSON.stringify(patch.result)
    }
    if (patch.schedule !== undefined) {
      sets.push('schedule = $schedule')
      params.$schedule = JSON.stringify(patch.schedule)
    }
    if (patch.completedAt !== undefined) {
      sets.push('completed_at = $completedAt')
      params.$completedAt = patch.completedAt
    }

    sets.push('updated_at = $updatedAt')

    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $id`).run(params)
    return this.getById(id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = $id').run({ $id: id })
  }

  getById(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = $id').get({ $id: id }) as Record<
      string,
      unknown
    > | null
    return row ? rowToTask(row) : null
  }

  list(filter?: { status?: TaskStatus; type?: TaskType }): Task[] {
    const conditions: string[] = []
    const params: Record<string, unknown> = {}

    if (filter?.status) {
      conditions.push('status = $status')
      params.$status = filter.status
    }
    if (filter?.type) {
      conditions.push('task_type = $type')
      params.$type = filter.type
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`)
      .all(params) as Record<string, unknown>[]
    return rows.map(rowToTask)
  }

  listScheduled(): Task[] {
    return this.list({ status: 'scheduled' })
  }

  appendMessage(taskId: string, message: Message): void {
    this.db
      .prepare(
        `INSERT INTO task_messages (task_id, role, content, tool_call_id, tool_name, args, result, timestamp)
         VALUES ($taskId, $role, $content, $toolCallId, $toolName, $args, $result, $timestamp)`,
      )
      .run({
        $taskId: taskId,
        $role: message.type,
        $content: message.type === 'tool_call' ? '' : 'content' in message ? message.content : '',
        $toolCallId: 'toolCallId' in message ? message.toolCallId : null,
        $toolName: 'toolName' in message ? message.toolName : null,
        $args: message.type === 'tool_call' ? JSON.stringify(message.args) : null,
        $result: message.type === 'tool_result' ? JSON.stringify(message.result) : null,
        $timestamp: message.timestamp,
      })
  }

  getMessages(taskId: string): Message[] {
    const rows = this.db
      .prepare('SELECT * FROM task_messages WHERE task_id = $taskId ORDER BY timestamp ASC')
      .all({ $taskId: taskId }) as Record<string, unknown>[]
    return rows.map(messageFromRow)
  }

  close(): void {
    this.db.close()
  }
}
