import { z } from 'zod'
import type { ToolDefinition } from '../types'

const DEFAULT_MAX_MATCHES = 250
const EXCLUDED_DIRS = ['.git', 'node_modules', '.svn', '.hg', 'dist', 'build', '.next']

const parameters = z.object({
  pattern: z.string().describe('正则表达式搜索模式'),
  path: z.string().optional().describe('要搜索的文件或目录路径，默认当前工作目录'),
  glob: z.string().optional().describe('文件过滤 glob 模式，如 "*.ts"、"*.{js,jsx}"'),
  case_insensitive: z.boolean().optional().describe('是否忽略大小写，默认 false'),
})

async function hasRipgrep(): Promise<boolean> {
  try {
    await Bun.$`which rg`.quiet()
    return true
  } catch {
    return false
  }
}

function buildRgArgs(
  pattern: string,
  opts: { path?: string; glob?: string; case_insensitive?: boolean },
): string[] {
  const args = ['-n', '--no-heading', '--color=never']

  for (const dir of EXCLUDED_DIRS) {
    args.push('--glob', `!${dir}`)
  }

  if (opts.glob) args.push('--glob', opts.glob)
  if (opts.case_insensitive) args.push('-i')

  args.push('--max-count', String(DEFAULT_MAX_MATCHES))
  args.push(pattern)
  if (opts.path) args.push(opts.path)

  return args
}

function buildGrepArgs(
  pattern: string,
  opts: { path?: string; glob?: string; case_insensitive?: boolean },
): string[] {
  const args = ['-rn', '--color=never']

  for (const dir of EXCLUDED_DIRS) {
    args.push(`--exclude-dir=${dir}`)
  }

  if (opts.glob) args.push(`--include=${opts.glob}`)
  if (opts.case_insensitive) args.push('-i')

  args.push(pattern)
  args.push(opts.path ?? '.')

  return args
}

function parseOutput(raw: string): { matches: string[]; numFiles: number; numMatches: number } {
  const lines = raw.split('\n').filter(Boolean)
  const limited = lines.slice(0, DEFAULT_MAX_MATCHES)
  const files = new Set(limited.map((l) => l.split(':')[0]))

  return {
    matches: limited,
    numFiles: files.size,
    numMatches: limited.length,
  }
}

export const grepTool: ToolDefinition<typeof parameters> = {
  name: 'grep',
  description:
    'Search file contents using regex patterns. Uses ripgrep (rg) when available, falls back to grep.',
  parameters,
  riskLevel: 'safe',
  async execute({ pattern, path, glob, case_insensitive }) {
    const useRg = await hasRipgrep()
    const cmd = useRg ? 'rg' : 'grep'
    const args = useRg
      ? buildRgArgs(pattern, { path, glob, case_insensitive })
      : buildGrepArgs(pattern, { path, glob, case_insensitive })

    const proc = Bun.spawn([cmd, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    // exit code 1 = no matches (normal for grep/rg)
    if (exitCode > 1) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`${cmd} failed (exit ${exitCode}): ${stderr.trim()}`)
    }

    const result = parseOutput(stdout)

    return {
      ...result,
      tool: useRg ? 'ripgrep' : 'grep',
      ...(result.numMatches >= DEFAULT_MAX_MATCHES && {
        truncated: true,
        hint: `Results limited to ${DEFAULT_MAX_MATCHES} matches. Narrow your search pattern or use glob filter.`,
      }),
    }
  },
}
