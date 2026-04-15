import type { ToolDefinition } from '../tools/types'
import { generatePolicy } from './policy'

export type SandboxConfig = {
  readonly enabled: boolean
  readonly workingDirectory: string
}

const POLICY_DIR = '/tmp'
const policyFiles = new Set<string>()

function getPolicyPath(workDir: string): string {
  const hash = Bun.hash(workDir).toString(16)
  return `${POLICY_DIR}/the-next-sandbox-${hash}.sb`
}

async function isMacOS(): Promise<boolean> {
  return process.platform === 'darwin'
}

async function hasSandboxExec(): Promise<boolean> {
  try {
    await Bun.$`which sandbox-exec`.quiet()
    return true
  } catch {
    return false
  }
}

export const SandboxManager = {
  async isSupported(): Promise<boolean> {
    return (await isMacOS()) && (await hasSandboxExec())
  },

  async ensurePolicy(workDir: string): Promise<string> {
    const path = getPolicyPath(workDir)
    const content = generatePolicy(workDir)
    await Bun.write(path, content)
    policyFiles.add(path)
    return path
  },

  buildSpawnArgs(command: string, policyPath: string): string[] {
    return ['sandbox-exec', '-f', policyPath, 'bash', '-c', command]
  },

  async cleanup(): Promise<void> {
    for (const path of policyFiles) {
      try {
        await Bun.$`rm -f ${path}`.quiet()
      } catch {
        // best-effort
      }
    }
    policyFiles.clear()
  },
}

/**
 * 对工具列表应用沙箱包装。
 * 仅影响 bash 工具：将其 execute 替换为沙箱版本（spawn 前加 sandbox-exec 前缀）。
 * 其他工具原样返回。
 */
export const applySandbox = (
  tools: readonly ToolDefinition[],
  sandbox: SandboxConfig,
): readonly ToolDefinition[] => {
  if (!sandbox.enabled) return tools

  return tools.map((tool) => {
    if (tool.name !== 'bash') return tool

    const originalExecute = tool.execute
    
    return {
      ...tool,
      async execute(args: unknown) {
        const { command } = args as { command: string }
        const supported = await SandboxManager.isSupported()
        if (!supported) return originalExecute(args)

        const policyPath = await SandboxManager.ensurePolicy(sandbox.workingDirectory)
        const wrappedArgs = { ...(args as Record<string, unknown>) }
        // bash tool 内部用 buildDefaultSpawnArgs(command) → ['bash', '-c', command]
        // 我们需要把 command 改成让 sandbox-exec 包装的版本
        // 但 bash tool 内部会再套 bash -c，所以我们直接替换 command
        // sandbox-exec -f policy.sb bash -c "original command"
        // 等价于让 bash tool 执行: sandbox-exec -f policy.sb bash -c "original command"
        // 但 bash tool 会变成: bash -c "sandbox-exec -f policy.sb bash -c 'original command'"
        // 这样是可行的——外层 bash 启动 sandbox-exec，sandbox-exec 再启动内层 bash
        const escaped = command.replace(/'/g, "'\\''")
        wrappedArgs.command = `sandbox-exec -f '${policyPath}' bash -c '${escaped}'`
        return originalExecute(wrappedArgs)
      },
    } as ToolDefinition
  })
}
