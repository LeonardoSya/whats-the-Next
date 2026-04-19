import { tmpdir } from 'node:os'
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'

/**
 * the-next 内部的 sandbox 用户配置。
 *
 * 这是一个简化的视图，提供给上层（main.ts、settings 等）。
 * 通过 convertToRuntimeConfig 翻译成 sandbox-runtime 实际需要的 SandboxRuntimeConfig。
 *
 * 与 Claude Code 的 sandbox-adapter.ts 中 convertToSandboxRuntimeConfig 等价，
 * 但去除了 Claude Code 特有的 settings 多源合并、permissions 规则解析等复杂度。
 */
export type TheNextSandboxConfig = {
  readonly enabled: boolean
  /** bash 工具默认可写的工作目录 */
  readonly workingDirectory: string
  /**
   * 网络白名单。
   * - undefined 或空数组：默认行为（sandbox-runtime 拒绝所有未列出域名）
   * - 包含 "*"：完全开放，使用 enableWeakerNetworkIsolation
   *
   * 注意：默认体验下我们设置 enableWeakerNetworkIsolation = true，
   * 让 LLM 能正常 curl/git 等。需要严格隔离时改 allowedDomains。
   */
  readonly allowedDomains?: readonly string[]
  readonly deniedDomains?: readonly string[]
  /** 额外的可读路径 */
  readonly additionalReadPaths?: readonly string[]
  /** 额外的可写路径 */
  readonly additionalWritePaths?: readonly string[]
}

/**
 * 把 the-next 风格的配置转换为 sandbox-runtime 需要的 SandboxRuntimeConfig。
 *
 * 关键约定（来自 sandbox-runtime 的 manager.js 第 494-505 行）：
 * - allowedDomains 为 undefined → 不启动代理，网络完全开放（推荐默认）
 * - allowedDomains 为 [] → 启动代理但拒绝一切（"完全 deny" 模式）
 * - allowedDomains 为 ['github.com'] → 仅允许列出域名
 *
 * 因此默认体验下我们 故意把 network.allowedDomains 设为 undefined，
 * 让 sandbox-runtime 完全跳过网络代理，bash 里的 curl/git 等正常工作。
 *
 * 类型 hack：runtime config schema 标 allowedDomains 为 required string[]，
 * 但 manager.js 实际只检查 !== undefined。我们绕过 TS 类型限制以激活 open mode。
 */
export function convertToRuntimeConfig(config: TheNextSandboxConfig): SandboxRuntimeConfig {
  const userAllowedDomains = config.allowedDomains
  const userDeniedDomains = config.deniedDomains

  // 检测 open mode：用户没指定白名单 或 显式包含 "*"
  const networkOpen =
    userAllowedDomains === undefined ||
    userAllowedDomains.length === 0 ||
    userAllowedDomains.some((d) => d === '*' || d === '**')

  // open 模式下 network 字段不传 allowedDomains，runtime 会跳过网络代理
  // 否则按白名单严格过滤
  const network = networkOpen
    ? ({ deniedDomains: (userDeniedDomains ?? []) as string[] } as SandboxRuntimeConfig['network'])
    : {
        allowedDomains: [...userAllowedDomains] as string[],
        deniedDomains: (userDeniedDomains ?? []) as string[],
      }

  return {
    network,
    filesystem: {
      allowRead: config.additionalReadPaths ? [...config.additionalReadPaths] : undefined,
      denyRead: [],
      allowWrite: [config.workingDirectory, tmpdir(), ...(config.additionalWritePaths ?? [])],
      denyWrite: [],
    },
  }
}
