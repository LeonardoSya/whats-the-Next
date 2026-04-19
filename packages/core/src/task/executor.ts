import type { AgentContext } from '../agent/context'
import { runAgent } from '../agent/loop'
import { SandboxManager } from '../sandbox/manager'
import type { ApprovalCallback } from '../tools/permission'
import { toSDKTools } from '../tools/types'
import type { AgentConfig } from '../types/config'
import { createUserMessage, type Message } from '../types/message'
import { TaskLogger } from './logger'
import type { Task, TaskEvent, TaskResult } from './model'
import type { TaskStore } from './store'
import { collectSystemPromptAddons, mergeToolkitTools, resolveToolkits } from './toolkit'

const BASE_SYSTEM_PROMPT = `你是一个任务执行助手。你的目标是高效完成用户分配的任务。
完成后请简要总结执行结果和产出物。如果遇到问题，说明原因并建议替代方案。`

function buildTaskSystemPrompt(task: Task): string {
  const toolkits = resolveToolkits(task.taskType)
  const addons = collectSystemPromptAddons(toolkits)
  const parts = [BASE_SYSTEM_PROMPT]
  if (addons) parts.push(addons)
  parts.push(`\n当前任务：${task.title}\n任务描述：${task.description}`)
  return parts.join('\n\n')
}

/**
 * 执行一个 Task,驱动 agent loop 并将过程持久化到 TaskStore。
 * 全流程通过 TaskLogger 记录结构化 JSONL 日志。
 */
export async function* executeTask(
  task: Task,
  agentConfig: AgentConfig,
  store: TaskStore,
  opts?: {
    approve?: ApprovalCallback
  },
): AsyncGenerator<TaskEvent> {
  const log = new TaskLogger(task.id)
  const abortController = new AbortController()

  log.markExecutionStart()
  log.info('execute', 'Task execution starting', {
    taskId: task.id,
    title: task.title,
    taskType: task.taskType,
    toolkitIds: task.toolkitIds as unknown as string[],
  })

  store.update(task.id, { status: 'running' })
  yield { type: 'task_status_changed', taskId: task.id, status: 'running' }

  // ── ToolKit 解析 ──
  log.startTimer('toolkit_resolve')
  const toolkits = resolveToolkits(task.taskType)
  const tools = mergeToolkitTools(toolkits)
  log.endTimer('toolkit_resolve', 'info', 'toolkit', 'ToolKits resolved', {
    kits: toolkits.map((k) => k.id),
    toolCount: tools.length,
    toolNames: tools.map((t) => t.name),
  })
  log.debug('toolkit', 'Sandbox status', {
    available: SandboxManager.isAvailable(),
    unavailableReason: SandboxManager.getUnavailableReason(),
  })

  // ── Messages 准备 ──
  const existingMessages = store.getMessages(task.id)
  const messages: Message[] = [...existingMessages]
  log.debug('execute', 'Loaded existing messages', { count: existingMessages.length })

  if (messages.length === 0) {
    const userMsg = createUserMessage(task.description)
    messages.push(userMsg)
    store.appendMessage(task.id, userMsg)
    log.debug('execute', 'Injected initial user message', { content: task.description })
  }

  // ── System Prompt ──
  const systemPrompt = buildTaskSystemPrompt(task)
  log.debug('execute', 'System prompt built', {
    length: systemPrompt.length,
    preview: systemPrompt.slice(0, 200),
  })

  const ctx: AgentContext = {
    config: { ...agentConfig, systemPrompt },
    messages,
    tools: toSDKTools(tools, opts?.approve),
    abort: abortController,
    taskId: task.id,
  }

  // ── Agent Loop ──
  log.startTimer('agent_loop')
  log.info('agent_loop', 'Starting agent loop', {
    model: agentConfig.model,
    maxTokens: agentConfig.maxTokens ?? 4096,
    messageCount: messages.length,
  })

  // 跨 turn 累计的统计量(从 turn_complete 事件里取最新值,而不是自己重新计数)
  let lastAssistantText = ''
  let totalTurns = 0
  let totalToolCalls = 0

  try {
    for await (const event of runAgent(ctx)) {
      // ── 日志 / 统计副作用(yield 前同步完成) ──
      switch (event.type) {
        case 'state_change':
          log.debug('agent_loop', `Agent state → ${event.state}`)
          break

        case 'tool_call':
          totalToolCalls++
          log.info('tool_call', `Tool invoked: ${event.toolName}`, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            callIndex: totalToolCalls,
          })
          break

        case 'tool_result': {
          log.info('tool_result', `Tool completed: ${event.toolName}`, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            resultPreview: truncateForLog(event.result),
          })
          const violations = (event.result as { sandboxViolations?: string } | undefined)
            ?.sandboxViolations
          if (event.toolName === 'bash' && violations) {
            log.warn('tool_call', 'Sandbox violations detected', {
              toolCallId: event.toolCallId,
              violations,
            })
          }
          break
        }

        case 'tool_error':
          log.error('tool_call', `Tool error: ${event.toolName}`, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            error: event.error,
          })
          break

        case 'message_complete':
          store.appendMessage(task.id, event.message)
          lastAssistantText = event.message.content
          log.info('llm_response', 'Assistant message complete', {
            contentLength: event.message.content.length,
            preview: event.message.content.slice(0, 300),
          })
          break

        case 'turn_complete':
          // turn_complete 是 turn 边界的权威信号,直接用它的统计量(比自己数 state_change 准确)
          totalTurns = event.turnCount
          log.debug('agent_loop', `Turn ${event.turnCount} complete`, {
            transition: event.transition,
            toolCallCount: event.toolCallCount,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            durationMs: event.durationMs,
          })
          break

        case 'permission_request':
          log.warn('permission', `Permission requested for ${event.toolName}`, {
            permissionId: event.permissionId,
            riskLevel: event.riskLevel,
            args: event.args,
          })
          break

        case 'error':
          log.error('agent_loop', `Agent error: ${event.error}`)
          break
      }

      // ── yield 给上游(server WS 广播) ──
      yield { type: 'task_agent_event', taskId: task.id, event }
    }

    const result: TaskResult = {
      summary: lastAssistantText || '任务已执行完成',
    }

    log.endTimer('agent_loop', 'info', 'execute', 'Task completed successfully', {
      totalTurns,
      totalToolCalls,
      resultLength: result.summary.length,
    })

    store.update(task.id, { status: 'completed', result, completedAt: Date.now() })
    yield { type: 'task_status_changed', taskId: task.id, status: 'completed' }
    yield { type: 'task_result', taskId: task.id, result }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const result: TaskResult = { summary: '', error: errorMsg }

    log.endTimer('agent_loop', 'error', 'execute', 'Task execution failed', {
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
      totalTurns,
      totalToolCalls,
    })

    store.update(task.id, { status: 'failed', result })
    yield { type: 'task_status_changed', taskId: task.id, status: 'failed' }
    yield { type: 'task_result', taskId: task.id, result }
  }
}

function truncateForLog(value: unknown): unknown {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  if (str && str.length > 500) return `${str.slice(0, 500)}… [truncated, total ${str.length} chars]`
  return value
}
