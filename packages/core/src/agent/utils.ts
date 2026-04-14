import type { Message } from '..'

export const toSDKMessages = (
  messages: readonly Message[],
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> =>
  messages
    .filter(
      (msg): msg is Extract<Message, { type: 'user' | 'assistant' | 'system' }> =>
        msg.type === 'user' || msg.type === 'assistant' || msg.type === 'system',
    )
    .map((msg) => ({
      role: msg.type === 'user' ? 'user' : msg.type === 'assistant' ? 'assistant' : 'system',
      content: msg.content,
    }))
