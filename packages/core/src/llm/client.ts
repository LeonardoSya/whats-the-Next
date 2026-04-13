import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { AgentConfig } from '../types/config'

export const createMiniMaxModel = (config: AgentConfig): LanguageModel => {
  const provider = createOpenAICompatible({
    name: 'minimax',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  })

  return provider.chatModel(config.model)
}
