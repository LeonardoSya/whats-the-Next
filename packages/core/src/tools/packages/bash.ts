import { z } from 'zod'
import type { RiskLevel, ToolDefinition } from '../types'

const DEFAULT_TIMEOUT = 30_000
const MAX_TIMEOUT = 600_000
const MAX_OUTPUT_CHARS = 30_000

const SAFE_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'pwd',
  'echo',
  'date',
  'whoami',
  'which',
  'where',
  'env',
  'printenv',
  'file',
  'stat',
  'du',
  'df',
  'tree',
  'find',
  'grep',
  'rg',
  'ag',
  'ack',
  'sort',
  'uniq',
  'diff',
  'git status',
  'git log',
  'git diff',
  'git branch',
  'git show',
  'git remote',
])

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[^\s]*)?.*(-r|-f|--recursive|--force)/,
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\bmkfs\b/,
  /\bdd\s+/,
  />\s*\/dev\/sd/,
  /\bcurl\b.*\|\s*(bash|sh|zsh)\b/,
  /\bwget\b.*\|\s*(bash|sh|zsh)\b/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bkill\s+-9\b/,
  /\bkillall\b/,
  /\bformat\b/,
  /\b>\s*\/etc\//,
]

function classifyBashRisk({ command }: { command: string }): RiskLevel {
  const trimmed = command.trim()
  const firstCmd = (trimmed.split(/\s*[|&;]\s*/)[0] ?? '').trim()

  if (
    SAFE_COMMANDS.has(firstCmd) ||
    SAFE_COMMANDS.has(trimmed.split(/\s+/).slice(0, 2).join(' '))
  ) {
    return 'safe'
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) return 'dangerous'
  }

  return 'write'
}

const parameters = z.object({
  command: z.string().describe('要执行的 bash 命令'),
  timeout: z
    .number()
    .optional()
    .describe(`超时时间（毫秒），默认 ${DEFAULT_TIMEOUT}，最大 ${MAX_TIMEOUT}`),
})

const truncateOutput = (text: string): string => {
  if (text.length <= MAX_OUTPUT_CHARS) return text
  const kept = text.slice(0, MAX_OUTPUT_CHARS)
  const removed = text.length - MAX_OUTPUT_CHARS
  return `${kept}\n\n[output truncated — ${removed} characters removed]`
}

/**
 * bash 工具的 spawn 参数构建器。
 * 默认返回 ['bash', '-c', cmd]，外层可通过 sandbox wrapper 替换。
 */
export function buildDefaultSpawnArgs(command: string): string[] {
  return ['bash', '-c', command]
}

export const bashParameters = parameters

export const bashTool: ToolDefinition<typeof parameters> = {
  name: 'bash',
  description:
    'Execute a bash command and return its output. Use for running shell commands, scripts, git operations, etc.',
  parameters,
  riskLevel: classifyBashRisk,
  async execute({ command, timeout }) {
    const timeoutMs = Math.min(timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)

    const proc = Bun.spawn(buildDefaultSpawnArgs(command), {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeoutMs)

    try {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited

      const result: Record<string, unknown> = {
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        exitCode,
      }
      if (timedOut) {
        result.timedOut = true
        result.message = `Command timed out after ${timeoutMs}ms`
      }
      return result
    } finally {
      clearTimeout(timer)
    }
  },
}
