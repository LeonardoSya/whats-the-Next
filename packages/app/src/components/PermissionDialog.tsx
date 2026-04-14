import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { PermissionRequest } from '@/hooks/useAgent'

type PermissionDialogProps = {
  readonly request: PermissionRequest | null
  readonly onRespond: (permissionId: string, approved: boolean) => void
}

function formatArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

export function PermissionDialog({ request, onRespond }: PermissionDialogProps) {
  if (!request) return null

  const handleApprove = () => onRespond(request.permissionId, true)
  const handleDeny = () => onRespond(request.permissionId, false)

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && handleDeny()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-700 text-xs font-bold dark:bg-red-900/40 dark:text-red-400">
              !
            </span>
            需要确认操作
          </DialogTitle>
          <DialogDescription>AI 请求执行一个需要审批的操作，请确认是否允许。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">工具：</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {request.toolName}
            </code>
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
              {request.riskLevel}
            </span>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              参数
            </p>
            <pre className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap break-all">
              {formatArgs(request.args)}
            </pre>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleDeny}>
            拒绝
          </Button>
          <Button variant="destructive" onClick={handleApprove}>
            允许执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
