import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const host = process.env.TAURI_DEV_HOST

/**
 * Vite 配置 — Tauri + React + Tailwind CSS v4
 *
 * - `@tailwindcss/vite` 插件处理 Tailwind 的 CSS 编译
 * - `@` 路径别名映射到 `./src`，与 shadcn/ui 约定一致
 * - Tauri 相关配置保持固定端口和 HMR 设置
 */
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  /* Tauri 开发专用配置 */
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}))
