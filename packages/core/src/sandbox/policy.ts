/**
 * macOS Seatbelt (.sb) 策略生成
 *
 * 根据项目工作目录动态生成沙箱策略：
 * - 默认拒绝一切
 * - 允许进程基本能力（exec / fork）
 * - 系统路径只读
 * - 项目目录可读可写
 * - 临时目录可读可写
 * - 网络出站允许（MVP 不限域名）
 */
export function generatePolicy(workingDirectory: string): string {
  return `(version 1)
(deny default)

;; --- 进程基础能力 ---
(allow process-exec)
(allow process-fork)
(allow signal)
(allow sysctl-read)
(allow mach-lookup)
(allow mach-register)
(allow ipc-posix-shm-read-data)
(allow ipc-posix-shm-write-data)

;; --- 系统路径：只读 ---
(allow file-read*
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/Library")
  (subpath "/System")
  (subpath "/private/tmp")
  (subpath "/private/var")
  (subpath "/dev")
  (subpath "/etc")
  (subpath "/var")
  (subpath "/opt"))

;; --- 用户 home 下常见只读路径 ---
(allow file-read*
  (subpath "${workingDirectory}"))
(allow file-write*
  (subpath "${workingDirectory}"))

;; --- 临时目录：可读可写 ---
(allow file-read* (subpath "/tmp"))
(allow file-write* (subpath "/tmp"))
(allow file-read* (subpath "/private/tmp"))
(allow file-write* (subpath "/private/tmp"))

;; --- 网络：允许出站（MVP 不限域名）---
(allow network-outbound)
(allow network-inbound (local tcp))
(allow system-socket)
`
}
