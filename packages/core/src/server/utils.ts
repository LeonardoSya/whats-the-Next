import { mkdirSync } from 'node:fs'
import { CONFIG_DIR } from './config'

export function maskApiKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 8)}***` : '***'
}

export const ensureDir = () => {
  mkdirSync(CONFIG_DIR, { recursive: true })
}

export const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
