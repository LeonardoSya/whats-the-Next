/**
 * 定义llm连接参数和行为设定
 */

export type AgentConfig = {
  // 模型标识符
  readonly model: string
  readonly apiKey: string
  // OpenAI兼容格式的llm api url
  readonly baseURL: string
  // 系统提示词
  readonly systemPrompt?: string
  // 最大输出token, default: 4096
  readonly maxTokens?: number
}
