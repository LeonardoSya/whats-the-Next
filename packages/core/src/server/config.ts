import { join } from 'node:path'
import type { AgentConfig } from '..'
import { homedir } from 'node:os'
import { ensureDir } from './utils'

// 未来以类似openclaw的文件存储方式管理配置
export const CONFIG_DIR = join(homedir(), '.the-next')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

export const loadConfig = async (): Promise<AgentConfig | null> => {
  try {
    const file = Bun.file(CONFIG_FILE)
    if (!(await file.exists())) return null
    return (await file.json()) as AgentConfig
  } catch {
    return null
  }
}

export const saveConfig = async (config: AgentConfig): Promise<void> => {
  ensureDir()
  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2))
}
