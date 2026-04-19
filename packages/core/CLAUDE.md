---
description: the-next core 包架构与开发规范
globs: "*.ts"
alwaysApply: true
---

# @the-next/core

类 Claude Code 的 AI agent 核心包。参考 `/Users/seiyazhang/fork-claude-code` 的设计理念。

## 架构分层

```
src/
├── server/          网络入口 + 工具链组装 + Task REST API
├── agent/           Agent 循环（不感知工具细节）
├── task/            Task 引擎（路由、执行、调度、持久化）
├── tools/           工具定义（纯数据，不含运行时配置）
├── sandbox/         macOS Seatbelt 沙箱
├── llm/             LLM 连接
└── types/           全局类型定义
```

### 双模数据流

**Chat 模式**（保留）：
用户输入 → server/main.ts 构建 AgentContext → agent/loop.ts 驱动 LLM 多轮交互 → 工具执行 → 结果回传

**Task 模式**（新增）：
用户描述 → TaskRouter 推断类型 → resolveToolkits 自动编排工具 → TaskExecutor 包装 AgentContext → runAgent → 结果持久化到 SQLite → WS 推送

### 工具链组装

Chat 模式：`getDefaultTools() → toSDKTools(tools, approve)`

Task 模式：`resolveToolkits(taskType) → mergeToolkitTools() → toSDKTools()`

registry 不知道权限，权限层不知道沙箱。沙箱由 bash 工具内部直接调用 `SandboxManager.wrapCommand()`，对外层透明。

## 设计原则

### 1. AgentContext 收敛依赖

runAgent 只接受一个 AgentContext 对象（含 config / messages / tools / abort / taskId）。新增能力加字段，不改签名。运行时事件分发**只走 generator yield 一条路**——调用方用 `for await` 消费，所有日志/统计/持久化副作用都在那里完成,不另开 callback 通路。

### 2. loop 不感知工具系统

loop.ts 不 import 任何 tools/ 模块，只认 AI SDK 的 ToolSet 类型。工具的注册、格式转换、权限包装、沙箱包装全部在 server 层完成。

### 3. Stream 翻译就地展开

loop.ts 在消费 `res.fullStream` 时,用 switch case 直接把 SDK 事件翻译成 AgentEvent yield 出去。不抽 handler table —— 5 个 case 都很短,内联反而比"跳到另一个文件查表"更易读。

### 4. index.ts 最小暴露

仅导出前端实际消费的类型（AgentState、Message、RiskLevel）。core 内部模块直接 import 源文件，不经 index.ts。

### 5. 工具是纯定义

ToolDefinition 包含 name、description、parameters（Zod schema）、execute、riskLevel。工具本身不知道权限和沙箱的存在，这些由外层透明包装。

### 6. 权限 = 风险分级 + 透明拦截

riskLevel 支持固定值（`'safe'`）或函数（bash 按命令内容动态判断）。dangerous 级别通过 WebSocket Promise 桥接前端弹窗确认。

### 7. 沙箱 = sandbox-runtime 透明包装

sandbox 用 `@anthropic-ai/sandbox-runtime` 库，bash 工具内部调 `SandboxManager.wrapCommand(command)` 得到带 sandbox-exec/bwrap + 本机代理 env 的完整 shell 字符串，再 `bash -c` 执行。命令执行后 `annotateStderr` 把 violation 拼到 stderr 末尾，让 LLM 知道哪些操作被拒。

启动时 `SandboxManager.init()` 一次：失败不抛异常，记录 `unavailableReason`，后续 `wrapCommand` 自动降级返回原命令。

### 8. Task = 任务驱动的 Agent 编排

用户只需描述任务，TaskRouter 自动推断任务类型（规则优先 + LLM fallback），resolveToolkits 自动匹配工具集。用户不需要手动装配 skill。

### 9. ToolKit = 领域聚合的工具组

ToolKit 按领域（docx、spreadsheet、pdf 等）聚合工具和 system prompt 片段。TaskType → ToolKit 是多对多映射，filesystem kit 是所有任务的兜底。

### 10. TaskScheduler = 后台主动执行

定时任务支持 runAt（一次性）和 cron（重复）。服务启动时从 SQLite 恢复定时器。

## 文件职责速查

| 文件 | 职责 |
|------|------|
| `server/main.ts` | Bun HTTP+WS 服务，Chat + Task REST API |
| `server/protocol.ts` | WebSocket 消息类型定义（含 TaskEvent） |
| `server/config.ts` | `~/.the-next/config.json` 读写 |
| `task/model.ts` | Task、TaskType、TaskStatus、TaskEvent 类型 |
| `task/store.ts` | TaskStore — SQLite 持久化（tasks + messages） |
| `task/router.ts` | TaskRouter — 规则匹配 + LLM 分类 |
| `task/toolkit.ts` | ToolKit 注册表 + resolveToolkits |
| `task/executor.ts` | TaskExecutor — 包装 runAgent 的任务执行器 |
| `task/scheduler.ts` | TaskScheduler — 后台定时器 |
| `agent/context.ts` | AgentContext 类型（含 abort、taskId） |
| `agent/loop.ts` | runAgent — 显式状态机主循环,通过 AsyncGenerator 单通路 yield 事件;SDK fullStream 翻译就地 switch |
| `agent/state.ts` | AgentLoopState + Transition 类型(状态机的"语言") |
| `tools/types.ts` | ToolDefinition 接口 + toSDKTools 转换 |
| `tools/permission.ts` | withPermissionGate 权限拦截 |
| `tools/registry.ts` | getDefaultTools() 工具注册表（Chat 模式用） |
| `tools/packages/*.ts` | 具体工具实现（含办公文档工具） |
| `sandbox/config.ts` | TheNextSandboxConfig + convertToRuntimeConfig |
| `sandbox/manager.ts` | SandboxManager 适配层（包裹 @anthropic-ai/sandbox-runtime） |
| `llm/client.ts` | OpenAI Compatible provider |
| `types/event.ts` | AgentEvent 联合类型 |
| `types/message.ts` | Message 联合类型 |
| `types/config.ts` | AgentConfig |

## 新增工具的步骤

### Chat 模式（全局工具）

1. 在 `tools/packages/` 下创建文件，导出 `ToolDefinition` 对象
2. 在 `tools/registry.ts` 的 `builtinTools` 数组中注册
3. 设置 `riskLevel`（safe / write / dangerous 或函数）

### Task 模式（领域工具）

1. 在 `tools/packages/` 下创建文件，导出 `ToolDefinition` 对象
2. 在 `task/toolkit.ts` 的对应 ToolKit 的 `tools` 数组中注册
3. 如需新 ToolKit，在 registry 数组中添加并关联 TaskType

## 新增 stream 事件的步骤

1. 在 `types/event.ts` 中定义新的事件类型，加入 AgentEvent 联合
2. 在 `agent/loop.ts` 消费 `res.fullStream` 那段的 switch 里加一个 case
3. 前端 `useAgent.ts` 的 switch 中添加处理分支

## Task REST API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/tasks` | POST | 创建任务（自然语言描述 → 自动路由） |
| `/api/tasks` | GET | 任务列表（?status=&type= 过滤） |
| `/api/tasks/:id` | GET | 任务详情 |
| `/api/tasks/:id` | PATCH | 更新任务 |
| `/api/tasks/:id` | DELETE | 删除任务 |
| `/api/tasks/:id/run` | POST | 手动触发执行 |
| `/api/tasks/:id/messages` | GET | 任务执行的对话历史 |

## 持久化

`~/.the-next/tasks.db`（bun:sqlite）存储 tasks 和 task_messages 两张表。`~/.the-next/config.json` 存储 LLM 配置。
