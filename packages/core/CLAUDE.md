# @the-next/core

> 学习 Claude Code 设计模式的 task-driven agent 内核。
> 区别于"对话轮驱动"的 chat agent，这里的一等公民是 **Task**：
> 每个用户输入都被装配成一个可调度、可持久化、可背景执行、可观测的执行单元。

---

## 1. 整体心智模型

```
┌────────────── User Input ──────────────┐
│                                        │
│  REST POST /api/tasks                  │
│       │                                │
│       ▼                                │
│  TaskRouter ─► TaskType + Title        │  ← 规则优先 / LLM fallback
│       │                                │
│       ▼                                │
│  ToolKit Registry ─► Tools + Addons    │  ← TaskType → ToolKit 正向映射
│       │                                │
│       ▼                                │
│  TaskStore.create() (sqlite)           │
│       │                                │
│       ▼                                │
│  TaskScheduler   ─或─  POST /run       │
│       │                                │
│       ▼                                │
│  executeTask() ──► runAgent()          │  ← 真正的 agent 状态机
│       │                │               │
│       │       ┌────────┴────────┐      │
│       │       │ AgentLoopState  │      │  ← while 循环 + 显式 transition
│       │       │ ・stepCountIs(1)│      │
│       │       │ ・每轮 LLM+tool │      │
│       │       └────────┬────────┘      │
│       │                │               │
│       ▼                ▼               │
│  TaskLogger     AgentEvent stream      │
│  (JSONL)              │                │
│                       ▼                │
│              WebSocket broadcast       │
└────────────────────────────────────────┘
```

两个核心判断（来自 Claude Code 的设计观）：
- **Agent Loop 是状态机，不是函数**：连续运行的复杂度（context 治理、失败恢复、工具回灌）必须显式化为 runtime 状态。
- **执行内核应该统一**：chat 与 task 不应该是两条并行流水线。当前 `handleChat` 与 `executeTask` 仍是对称重写，是 P1 的整合目标。

---

## 2. 目录结构与职责

```
src/
├── index.ts                  # 仅导出前端需要的 public types(白名单导出)
│
├── agent/                    # 推理内核 —— 唯一直接驱动 LLM 的层
│   ├── loop.ts               # runAgent 状态机骨架(while + 显式 transition)
│   ├── state.ts              # AgentLoopState + Transition 联合类型
│   └── context.ts            # AgentContext: runAgent 的唯一入参
│
├── task/                     # task-driven 引擎 —— 把"用户描述"变成"可执行单元"
│   ├── model.ts              # Task / TaskType / TaskStatus / TaskEvent
│   ├── router.ts             # 自然语言 → TaskType + Title(规则 + LLM 两路)
│   ├── toolkit.ts            # ToolKit 注册表(TaskType → Tools + system addon)
│   ├── executor.ts           # executeTask: 装配 ctx → 跑 loop → 持久化 + 日志
│   ├── store.ts              # bun:sqlite 持久化 tasks + task_messages
│   ├── scheduler.ts          # cron / runAt 后台调度器
│   └── logger.ts             # JSONL 结构化日志(每个 task 一个 .jsonl)
│
├── tools/                    # 工具系统 —— 内核外部最重要的扩展面
│   ├── types.ts              # ToolDefinition / RiskLevel / toSDKTools()
│   ├── permission.ts         # withPermissionGate(危险工具的审批门控)
│   ├── registry.ts           # 默认工具集(给 chat 模式用)
│   └── packages/             # 具体工具实现(bash / file_* / grep / docx_* / xlsx_* / pdf_*)
│
├── sandbox/                  # @anthropic-ai/sandbox-runtime 适配层
│   ├── manager.ts            # SandboxManager(单次 init + wrapCommand + violations)
│   └── config.ts             # the-next 配置 → SandboxRuntimeConfig 的翻译
│
├── server/                   # bun ws server —— 唯一对外接口
│   ├── main.ts               # Bun.serve: REST(任务 CRUD) + WS(chat + task event)
│   ├── protocol.ts           # ClientMessage / ServerMessage WS 协议
│   ├── config.ts             # AgentConfig 持久化(~/.the-next/config.json)
│   └── utils.ts              # http 工具(json/CORS/maskApiKey)
│
├── llm/
│   └── client.ts             # createMiniMaxModel(OpenAI 兼容,通过 baseURL 切换 provider)
│
└── types/                    # 跨模块共享类型(无依赖叶子)
    ├── event.ts              # AgentEvent 联合 + 各事件 payload
    ├── message.ts            # Message 联合 + AgentState + 各 factory
    └── config.ts             # AgentConfig
```

**依赖方向铁律（不许逆向引用）**：

```
types  ◄─  llm/sandbox/tools  ◄─  agent  ◄─  task  ◄─  server
```

`types/` 是叶子，不能 import 任何业务模块。`agent/` 不能反过来 import `task/` 或 `server/`。
`tools/types.ts` 中 `RiskLevel` 是 `tools` 自己的概念，但被 `index.ts` re-export 给前端用。

---

## 3. Agent Loop —— 这一层最值钱

`agent/loop.ts` 是整个 core 的发动机，看懂它就看懂了 80% 的 core。

### 设计要点

1. **单步采样**：`streamText({ stopWhen: stepCountIs(1) })`
   故意不让 SDK 自己跑多 step。每次 `streamText` 只跑一轮 LLM + 它本轮决定的所有 tool_call，
   然后必定停下，把控制权交还给我们的 `while` 循环。

2. **跨迭代状态显式化**：`AgentLoopState`
   ```ts
   {
     readonly messages: readonly ModelMessage[]      // 跨轮累积
     readonly turnCount: number
     readonly totalInputTokens: number
     readonly totalOutputTokens: number
     readonly transition?: Transition                // 上一轮怎么结束的
   }
   ```
   每轮迭代结束时显式 `state = { ...new values, transition: { kind } }`，
   不要 mutate。状态对象是不可变的。

3. **Transition 是状态机的边**：
   ```ts
   type Transition =
     | { kind: 'next_turn'; toolCallCount }   // 调了工具,下一轮继续
     | { kind: 'done'; reason: 'stop' }       // LLM 说话完了,正常结束
     | { kind: 'done'; reason: 'max_turns' }  // 撞到 turn 上限
     | { kind: 'aborted' }                    // 用户/系统中断
     | { kind: 'error'; error }               // 不可恢复错误
   ```
   未来要加 `recovery` / `compact` / `fallback` 时，扩这个联合即可，不动循环骨架。

4. **事件流 ≠ 状态流**：循环内 `yield AgentEvent` 是给上游消费的副作用流；
   `state` 是循环内部决策依据。两者解耦：消费方不能反推状态机。

### 关键事件序列（一次完整 turn）

```
state_change:thinking
  ─► [text-delta]+ → state_change:streaming → text_delta:*
  ─► tool-call → state_change:tool_calling → tool_call
     ─► tool-result → tool_result → state_change:thinking
  ─► finishReason='tool-calls' → turn_complete{transition:'next_turn'}
                                  → state_change:thinking → 下一轮
  ─► finishReason='stop'       → message_complete
                                → turn_complete{transition:'done'}
                                → state_change:done → return
```

### 改这一层时必须遵守

- **新转移类型**：先扩 `Transition` 联合，再加 `case` 分支，最后才 `yield turn_complete`。
- **新事件**：先扩 `AgentEvent` 联合（`types/event.ts`），再 `yield`。前端的 reducer 必须能识别。
- **不要把 `tools` 写死**：`tools` 来自 `ctx.tools`，循环本身对工具实现 0 知识。
- **`abort.signal.aborted` 检查点**：循环顶 + stream 消费内部各一处，不要漏。

---

## 4. Task 引擎 —— 把 agent 做成"可调度的执行单元"

### Task 生命周期

```
pending ──► running ──► completed
   │                       │
   │                       ▼
   ├──► scheduled ──► running ──► failed
   │                       │
   ├──► (DELETE) ──► gone  └──► cancelled
```

- `pending`：刚 POST，未执行。
- `scheduled`：附带 `schedule.runAt` 或 `schedule.cron`，由 `TaskScheduler` 持有 timer。
- `running`：`executeTask` 正在驱动 `runAgent`。
- `completed` / `failed`：`result.summary` 或 `result.error` 已写入。
- `cancelled`：用户主动取消（当前未实装完整路径）。

### TaskRouter（双路分类）

`task/router.ts` 走两层：

1. **规则路径** `routeTask()`：纯正则匹配，0 token，0 延迟，必定有兜底（`general`）。
2. **LLM 路径** `routeTaskAsync()`：规则没命中时，用 `generateObject` + zod schema 让 LLM 强类型分类。LLM 失败时仍返回 `general`，永不抛错。

写新 TaskType 时：先扩 `TaskType` 联合 → 在 `RULES` 加正则 → 在 `classifyWithLLM` 的 prompt 加描述 → 在 `toolkit.ts` 加 `ToolKit` 配 `taskTypes`。

### ToolKit 注册表

`task/toolkit.ts` 是 task 模式下"能力面装配"的当前实现：

```
TaskType ──filter──► ToolKit[] ──merge──► ToolDefinition[]
                          │
                          └──collect──► systemPromptAddon
```

**与 Claude Code 的差异**：Claude Code 用 `resolveAgentTools` 黑白名单负向过滤，我们用 `taskTypes: TaskType[]` 正向声明，工具编排对用户透明（每个 ToolKit 自己声明它服务哪些 TaskType）。

**演进方向**：见 `todo.md` P3-#3，要把"创建时一次性算"改成"每轮 turn 重算"，
为热接入 MCP 工具、长 task 中途注入 skill 铺路。

### TaskExecutor

`task/executor.ts` 是 task 模式与 agent loop 的桥：

- 输入：`Task` + `AgentConfig` + `TaskStore`
- 副作用：
  - 入 sqlite（status、message、result）
  - 写 JSONL 日志（每个阶段计时 + 结构化数据）
  - 透传 AgentEvent 到 server，server 再 broadcast
- 输出：`AsyncGenerator<TaskEvent>`

**改这里时**：
- 新增"执行阶段"先在 `TaskLogger.startTimer/endTimer` 包一对，方便后期分析性能。
- 不要在 `case 'tool_result'` 加 `if (toolName === 'bash')` 之类的特判（违反工具封装），
  应该在 `runAgent` 里加"回灌前 hook"（todo P0-#4）。

### TaskStore

`bun:sqlite` 两张表：`tasks` + `task_messages`，外键级联删除。
WAL 模式 + 启动时跑 MIGRATIONS 数组（幂等的 `CREATE TABLE IF NOT EXISTS`）。
加列时**追加**到 MIGRATIONS 末尾，不要改老的语句。

### TaskScheduler

最小可用 cron 解析器（`minute hour dom mon dow`，只支持 `*` 和数字）。
启动时从 store 加载所有 `scheduled` 任务重建 timer。
`onTrigger` 是注入回调（当前由 `server/main.ts` 注入 `runTaskInBackground`），
保持 `scheduler` 自身对 `executor` 0 依赖。

### TaskLogger

写 `~/.the-next/logs/{taskId}.jsonl`，每条 JSON 一行，append-only。
`LogPhase` 是固定枚举（`route` / `toolkit` / `execute` / `agent_loop` / `tool_call` / ...），
新增阶段前先扩 `LogPhase` 联合。
所有写操作 best-effort（`try/catch` 吞掉），**永远不要让 logging 阻塞主流程**。

---

## 5. 工具系统

### ToolDefinition（自家协议）

```ts
type ToolDefinition<TInput = z.ZodTypeAny> = {
  name: string
  description: string                                       // 给 LLM 看
  parameters: TInput                                        // zod schema
  execute: (args: z.infer<TInput>) => Promise<unknown>
  riskLevel?: RiskLevel | ((args) => RiskLevel)            // 静态或动态分级
}
```

`toSDKTools()` 把 `ToolDefinition[]` 翻译成 AI SDK 的 `ToolSet`。
传 `approve` 回调时会自动用 `withPermissionGate` 包装 `dangerous` 工具的 `execute`。

### RiskLevel 三级

| level | 行为 | 示例 |
|-------|------|------|
| `safe` | 直接执行 | `file_read`, `grep`, `ls`, `cat` |
| `write` | 直接执行（MVP 自动放行） | `file_write`, 普通 `bash` |
| `dangerous` | 阻塞等待 user approve | `rm -rf`, `sudo`, `chmod 777`, `dd` |

`bash` 工具的 `riskLevel` 是函数：`classifyBashRisk` 拆 pipeline 第一段命令做匹配。
扩展危险模式时改 `bash.ts:DANGEROUS_PATTERNS`。

### Sandbox 协作

`bash.ts:execute` 内部：
1. `SandboxManager.wrapCommand(command)` —— 把 `cmd` 包装成 `sandbox-exec/bwrap` 包裹的字符串（不可用时返回原命令，对调用方透明）。
2. 执行后 `SandboxManager.annotateStderr(command, stderr)` —— 把 sandbox 拦截记录拼到 stderr 末尾。
3. 拼出来的 `sandboxViolations` 字段会回灌给 LLM，让模型知道哪些操作被拒了。

**进程树管理**：bash 形成 4-5 层进程链（`bash → sandbox-exec → bash → 用户命令`），
超时只杀最外层会让 stdout pipe 永不 EOF。`killProcessTree` 用 `pgrep -P` 递归 SIGKILL。
**永远不要把这个删掉换成 `proc.kill()`**。

### 写新工具

模板：

```ts
// src/tools/packages/<your-tool>.ts
import { z } from 'zod'
import type { ToolDefinition } from '../types'

const parameters = z.object({
  /* 字段都加 .describe() —— LLM 完全靠 description 决定怎么填 */
})

export const yourTool: ToolDefinition<typeof parameters> = {
  name: 'your_tool',                  // snake_case,LLM 友好
  description: '...',                 // 一句话,让 LLM 知道何时用它
  parameters,
  riskLevel: 'safe',                  // 或函数
  async execute({ ... }) {
    /* 抛错时直接 throw new Error(),会变 ToolErrorEvent */
    return { /* 结构化结果,不要塞超长字符串 */ }
  },
}
```

注册：
- 给 chat 用 → 加到 `tools/registry.ts:builtinTools`
- 给 task 用 → 加到 `task/toolkit.ts` 某个 `ToolKit.tools`

---

## 6. 事件协议（前端的唯一信源）

### AgentEvent —— LLM 这一轮发生了什么

| 事件 | 何时 | 主要字段 |
|------|------|----------|
| `state_change` | agent 子状态切换 | `state: AgentState` |
| `text_delta` | 流式 token | `delta: string` |
| `message_complete` | 一段 assistant 文本完成 | `message: AssistantMessage` |
| `tool_call` | LLM 决定调工具 | `toolCallId, toolName, args` |
| `tool_result` | 工具成功 | `toolCallId, toolName, result` |
| `tool_error` | 工具抛错（不终止 loop） | `toolCallId, toolName, error` |
| `permission_request` | dangerous 工具等审批 | `permissionId, toolName, args, riskLevel` |
| `turn_complete` | 一轮 turn 边界 | `turnCount, toolCallCount, tokens, durationMs, transition` |
| `error` | loop 不可恢复错误 | `error: string` |

`AgentState`：`idle | thinking | streaming | tool_calling | error | done`

### TaskEvent —— task 维度的包装

```ts
type TaskEvent =
  | { type: 'task_status_changed', taskId, status }
  | { type: 'task_agent_event', taskId, event: AgentEvent }
  | { type: 'task_result', taskId, result }
```

### Server WS 协议

```ts
type ClientMessage = ChatRequest | AbortRequest | PermissionResponse | TaskRunRequest
type ServerMessage = EventMessage | TaskEventMessage | ReadyMessage | ErrorMessage
```

**当前痛点（todo P1-#5）**：`AgentEvent` 与 `TaskEvent` 是两条并行流，前端 `useAgent` 与 `useTasks` 各自维护一份连接和 reducer。要演进成统一的 `ControlPlaneEvent`。

---

## 7. Server 入口

`server/main.ts` 是唯一对外接口（给 tauri webview / 任何 http client）。

### REST 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config` | GET/POST | AgentConfig 读写（apiKey 返回时 mask） |
| `/api/config/full` | GET | 完整配置（含明文 key，仅本机用） |
| `/api/tasks` | POST | 创建 task（异步 router → toolkit → store → schedule） |
| `/api/tasks` | GET | 列表，支持 `?status=&type=` |
| `/api/tasks/:id` | GET/PATCH/DELETE | 单任务 CRUD |
| `/api/tasks/:id/messages` | GET | 任务的对话历史 |
| `/api/tasks/:id/run` | POST | 手动触发执行 |
| `/api/tasks/:id/logs` | GET | JSONL 日志，支持 `?level=&phase=&limit=&offset=` |
| `/api/logs/dir` | GET | 日志目录路径（调试用） |

### WS 端点

`/ws` 一条连接，**广播所有 task_event 给所有连接客户端**（多 tab 实时同步）。
chat 模式的 event 仍按 `id` 单播（避免串台）。

### 启动流程

```
startServer()
  ├─ SandboxManager.init(config)        # 失败不抛,降级跑
  ├─ Bun.serve({ ... })                 # 自动找 3001-3010 可用端口
  └─ taskScheduler.init()               # 重建 scheduled 任务的 timer
```

---

## 8. Sandbox

`@anthropic-ai/sandbox-runtime` 包装层。所有 API **降级安全**：
- 平台不支持（非 macOS/Linux/WSL2）→ `unavailableReason` 记原因，`wrapCommand` 直接返回原命令
- 缺依赖 → 同上
- `annotateStderr` 在不可用时返回原 stderr

**默认配置**（`server/main.ts:startServer`）：
- `enabled: true`
- `workingDirectory: process.cwd()` —— bash 默认可写目录
- `allowedDomains: undefined` —— **故意**不传，让 sandbox-runtime 跳过网络代理（`curl/git` 正常工作）

要开严格网络隔离时显式传 `allowedDomains: ['github.com', ...]`。
传 `[]` 会切到"完全 deny"模式。

---

## 9. 当前演进阶段（P0 → P3）

阅读顺序参考 `the-next/todo.md`，本节只做**当前进度快照**：

| 编号 | 项目 | 状态 |
|------|------|------|
| P0-#1 | Agent Loop 升格为状态机 | ✅ 已落地（`agent/state.ts` + `agent/loop.ts` 已重写） |
| P0-#4 | 工具回灌做成显式 runtime 步骤 | ⏳ 当前仍依赖 SDK 自动回灌（虽然 `stepCountIs(1)` 已为此铺路） |
| P1-#2 | 统一 chat 和 task 为同一执行内核 | ⏳ `handleChat` 与 `executeTask` 仍是对称重写 |
| P1-#5 | 控制面统一事件协议 | ⏳ `AgentEvent` 与 `TaskEvent` 仍并列 |
| P2 配套 | 简单 recovery（max output 截断续跑） | ⏳ 状态机已有 transition slot，handler 未加 |
| P2-#6 | Background task 通知机制 | ⏳ |
| P3-#3 | turn-scoped 能力面动态装配 | ⏳ |

**改 core 时的优先级判断**：能用现有结构表达的就别改架构；要加新转移/事件/阶段先扩对应的联合类型；要做控制面相关的改动先看 P1-#5 的演进方向，避免增量修改后再被推翻。

---

## 10. 给 AI agent 的硬约束

工作时必须遵守：

1. **使用 Bun**：项目已统一 Bun 工具链。`bun:sqlite`、`Bun.file`、`Bun.spawn`、`Bun.$` 优先于 node 等价物。详见根目录 `CLAUDE.md`。

2. **类型先于实现**：所有跨模块边界必须经过 `types/` 或本模块的 type 文件。新增 event 先扩 `types/event.ts:AgentEvent`，新增 transition 先扩 `agent/state.ts:Transition`。

3. **不要在 loop 里写工具特判**：`if (toolName === 'bash')` 在 `executor.ts` 出现过一次（处理 sandboxViolations），那是 todo P0-#4 要清理的债。新代码里别再这么写。

4. **不要 mutate state**：`AgentLoopState` 是 readonly，每次循环结束 `state = { ...new }`。

5. **日志 best-effort**：`TaskLogger` 所有写操作必须 `try/catch` 吞错。**永远不要让 logging 阻塞主流程或抛错出来**。

6. **public types 白名单**：`src/index.ts` 只导出前端真用得到的类型。**不要把内部实现细节（`AgentLoopState`、`Transition`、`ToolDefinition`、`SandboxManager` 等）暴露给前端**——它们演进时不需要考虑前端兼容性。

7. **Risk 默认 `write`**：新工具如果不写 `riskLevel`，会默认 `write`（自动放行但留有提升通道）。读类工具记得显式标 `safe`。

8. **Sandbox 不可用 ≠ 失败**：所有 sandbox 调用必须降级安全，跑不起来就当透明（用户已经被启动日志告知）。

9. **DB schema 加列只能 append**：往 `MIGRATIONS` 数组末尾追加新的 `ALTER TABLE` 或新表，不要改老的 `CREATE TABLE` 语句。

10. **改完跑 lint**：`bun run lint`（biome）。这个项目对未使用 import / 类型隐式 any 是零容忍。

---

## 11. 常见任务的入口

| 想做的事 | 改哪 |
|----------|------|
| 加新工具 | `tools/packages/<name>.ts` + `tools/registry.ts` 或 `task/toolkit.ts` |
| 加新 TaskType | `task/model.ts:TaskType` + `task/router.ts:RULES` + `task/toolkit.ts` |
| 加新 ToolKit | `task/toolkit.ts` 新增 `ToolKit` 对象 + 进 `registry` |
| 加新 agent 事件 | `types/event.ts:AgentEvent` 联合 + `agent/loop.ts:yield` |
| 加新状态机 transition | `agent/state.ts:Transition` 联合 + `agent/loop.ts` 处理分支 |
| 改 LLM provider | `llm/client.ts`（当前是 OpenAI compatible，可以扩多 provider 工厂） |
| 加新日志阶段 | `task/logger.ts:LogPhase` 联合 |
| 加新 REST 端点 | `server/main.ts:handleApiRequest` |
| 加新 WS 消息类型 | `server/protocol.ts:ClientMessage/ServerMessage` |
| 改 sandbox 策略 | `sandbox/config.ts:convertToRuntimeConfig` |

不知道改哪时，先在 `todo.md` 找最相关的 P 编号，按那条的"改造范围"开工。
