/**
 * Sandbox 适配层 — 包裹 @anthropic-ai/sandbox-runtime。
 *
 * 完全借鉴 Claude Code 的 sandbox-adapter.ts 模式：
 * - 单次 init() 启动后台 HTTP/SOCKS 代理 + violation 监听器
 * - wrapCommand() 把用户命令包装为完整的 shell 字符串
 * - 不可用时优雅降级（返回原命令，不抛异常）
 * - annotateStderr() 把 sandbox 违规信息附加到 stderr 末尾给 LLM 看
 */
import {
  SandboxManager as BaseSandboxManager,
  type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import { convertToRuntimeConfig, type TheNextSandboxConfig } from './config'

export type { TheNextSandboxConfig } from './config'

let initializationPromise: Promise<void> | undefined
let currentConfig: TheNextSandboxConfig | undefined
let unavailableReason: string | undefined

function isPlatformSupported(): boolean {
  try {
    return BaseSandboxManager.isSupportedPlatform()
  } catch {
    return false
  }
}

function checkDeps(): { errors: string[]; warnings: string[] } {
  try {
    return BaseSandboxManager.checkDependencies()
  } catch (e) {
    return { errors: [e instanceof Error ? e.message : String(e)], warnings: [] }
  }
}

/**
 * the-next 的 sandbox 管理器。所有 API 都对降级安全。
 */
export const SandboxManager = {
  /**
   * 启动时调用一次。失败不抛异常，记入 unavailableReason 后续静默降级。
   *
   * @param config 用户配置
   * @returns 是否成功启用
   */
  async init(config: TheNextSandboxConfig): Promise<boolean> {
    currentConfig = config

    if (!config.enabled) {
      unavailableReason = undefined
      return false
    }

    if (!isPlatformSupported()) {
      unavailableReason = `platform ${process.platform} is not supported (requires macOS, Linux or WSL2)`
      return false
    }

    const deps = checkDeps()
    if (deps.errors.length > 0) {
      unavailableReason = `missing dependencies: ${deps.errors.join(', ')}`
      return false
    }

    if (initializationPromise) {
      await initializationPromise
      return unavailableReason === undefined
    }

    initializationPromise = (async () => {
      try {
        const runtimeConfig: SandboxRuntimeConfig = convertToRuntimeConfig(config)
        // 第三个参数 enableLogMonitor=true 让 macOS 起 violation 监听
        await BaseSandboxManager.initialize(runtimeConfig, undefined, true)
        unavailableReason = undefined
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        unavailableReason = `initialize failed: ${msg}`
        initializationPromise = undefined
      }
    })()

    await initializationPromise
    return unavailableReason === undefined
  },

  /** 沙箱当前是否可用（已初始化成功）。 */
  isAvailable(): boolean {
    return (
      currentConfig?.enabled === true &&
      initializationPromise !== undefined &&
      unavailableReason === undefined
    )
  },

  /**
   * 用户开了沙箱但跑不起来时的原因，方便启动时打印警告。
   * 返回 undefined 表示没问题或用户没启用。
   */
  getUnavailableReason(): string | undefined {
    return unavailableReason
  },

  /**
   * 把命令包装为带沙箱的可执行字符串。
   * 不可用时直接返回原命令，调用方无需关心。
   */
  async wrapCommand(command: string, abortSignal?: AbortSignal): Promise<string> {
    if (!this.isAvailable()) return command
    try {
      return await BaseSandboxManager.wrapWithSandbox(command, undefined, undefined, abortSignal)
    } catch (e) {
      console.warn('[sandbox] wrapCommand failed, falling back to unwrapped:', e)
      return command
    }
  },

  /**
   * 在 bash 命令执行后调用，把 sandbox-runtime 记录的 violation 拼到 stderr 末尾。
   * 让 LLM 能看到"哪些操作被沙箱拒了"。
   */
  annotateStderr(command: string, stderr: string): string {
    if (!this.isAvailable()) return stderr
    try {
      return BaseSandboxManager.annotateStderrWithSandboxFailures(command, stderr)
    } catch {
      return stderr
    }
  },

  /** 每次命令执行后调用，清理 violation store 等命令级状态。 */
  cleanup(): void {
    if (!this.isAvailable()) return
    try {
      BaseSandboxManager.cleanupAfterCommand()
    } catch {
      // best-effort
    }
  },

  /** 关闭沙箱、释放代理端口等（进程退出时调用，可选）。 */
  async reset(): Promise<void> {
    if (initializationPromise) {
      try {
        await BaseSandboxManager.reset()
      } catch {
        // best-effort
      }
    }
    initializationPromise = undefined
    currentConfig = undefined
    unavailableReason = undefined
  },
}
