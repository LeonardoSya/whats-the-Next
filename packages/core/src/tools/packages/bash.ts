import { z } from 'zod'
import { SandboxManager } from '../../sandbox/manager'
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
 * 递归 SIGKILL 一个进程的所有后代进程，最后杀自己。
 *
 * 必要性：bash 工具运行 `bash -c "sandbox-exec bash -c '...'"`，
 * 形成 4-5 层进程链。仅杀最外层 bash 不会让子进程退出，
 * 而 stdout/stderr pipe 的 write end 被子进程持有，pipe 不会 EOF，
 * 导致 `new Response(proc.stdout).text()` 永远卡住。
 */
async function killProcessTree(pid: number): Promise<void> {
  try {
    const result = await Bun.$`pgrep -P ${pid}`.nothrow().quiet()
    const children = result
      .text()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
    await Promise.all(children.map(killProcessTree))
  } catch {
    /* ignore enumeration errors */
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* already dead */
  }
}

export const bashParameters = parameters

/**
 * Bash 工具 — 执行 shell 命令。
 *
 * 沙箱集成：execute 内部调用 SandboxManager.wrapCommand，
 * 由 sandbox-runtime 拼出带 sandbox-exec/bwrap + 代理环境变量的完整字符串。
 * SandboxManager 不可用时直接执行原命令，对调用方透明。
 *
 * 超时管理：自己管理超时，不依赖 Bun.spawn 的 signal 选项（后者只杀主进程，
 * 不会传递到沙箱内的子进程链）。超时时递归 SIGKILL 整个进程树，确保 stdout
 * pipe 能正常 EOF。
 *
 * 命令执行后调用 SandboxManager.annotateStderr 把 violation 拼到 stderr 末尾，
 * 让 LLM 知道哪些操作被沙箱拒了。
 */
export const bashTool: ToolDefinition<typeof parameters> = {
  name: 'bash',
  description:
    'Execute a bash command and return its output. Use for running shell commands, scripts, git operations, etc.\n\n' +
    'CAUTION: Avoid wildcards that expand to root paths. ' +
    'For example `/.*` expands to `/. /.. /.file ...` — `/.` is the filesystem root, ' +
    'so `du -sh /.*` will recursively scan the entire disk and time out. ' +
    'Use specific paths like `ls -la /` or `du -sh /Users/$USER/Library/Caches` instead.',
  parameters,
  riskLevel: classifyBashRisk,
  async execute({ command, timeout }) {
    const timeoutMs = Math.min(timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
    const wrappedCommand = await SandboxManager.wrapCommand(command)

    const proc = Bun.spawn(['bash', '-c', wrappedCommand], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(proc.pid).catch(() => {})
    }, timeoutMs)

    try {
      const [stdoutText, stderrText] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited

      const annotatedStderr = SandboxManager.annotateStderr(command, stderrText)
      const sandboxViolations =
        annotatedStderr !== stderrText ? annotatedStderr.slice(stderrText.length).trim() : undefined

      const result: Record<string, unknown> = {
        stdout: truncateOutput(stdoutText),
        stderr: truncateOutput(annotatedStderr),
        exitCode,
      }
      if (timedOut) {
        result.timedOut = true
        result.message = `Command timed out after ${timeoutMs}ms and the entire process tree was killed`
      }
      if (sandboxViolations) {
        result.sandboxViolations = sandboxViolations
      }
      return result
    } finally {
      clearTimeout(timer)
      SandboxManager.cleanup()
    }
  },
}
