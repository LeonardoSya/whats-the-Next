import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { discoverServer, getHttpBase } from '@/lib/server'

type SettingsPanelProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSaved: () => void
}

type StoredConfig = {
  configured: boolean
  apiKey?: string
  baseURL?: string
  model?: string
  systemPrompt?: string
  maxTokens?: number
}

/**
 * 设置面板 — API Key 和 LLM 配置
 *
 * 通过 REST API 与 Bun Server 通信，配置存储在服务端。
 */
export function SettingsPanel({ open, onOpenChange, onSaved }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('https://api.minimaxi.com/v1')
  const [model, setModel] = useState('MiniMax-M2.7')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return

    const load = async () => {
      try {
        await discoverServer()
        const res = await fetch(`${getHttpBase()}/api/config`)
        const config: StoredConfig = await res.json()
        if (config.configured) {
          if (config.baseURL) setBaseURL(config.baseURL)
          if (config.model) setModel(config.model)
        }
      } catch {
        // 首次使用或服务未启动
      }
    }
    load()
  }, [open])

  const handleSave = useCallback(async () => {
    if (!apiKey.trim() && !saving) {
      setError('请输入 API Key')
      return
    }

    setSaving(true)
    setError('')

    try {
      await discoverServer()
      const res = await fetch(`${getHttpBase()}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          baseURL: baseURL.trim(),
          model: model.trim(),
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }, [apiKey, baseURL, model, saving, onSaved])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>API 设置</DialogTitle>
          <DialogDescription>配置 LLM API 连接信息，配置将安全存储在本地。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="base-url">Base URL</Label>
            <Input
              id="base-url"
              type="url"
              placeholder="https://api.minimaxi.com/v1"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              type="text"
              placeholder="MiniMax-M2.7"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
