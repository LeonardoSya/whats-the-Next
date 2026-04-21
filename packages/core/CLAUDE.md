# @the-next/core

> 学习 Claude Code 设计模式的单轮对话 agent 内核 + 内置工具集 + bun ws server 桥接前端。
>
> 这一层只做"agent runtime"和"前端桥接"两件事，**不做任何业务封装**（不做 task / 不做调度 / 不做持久化）。
> 业务侧能力请在外层另起包，core 只暴露最小但完备的 agent 能力面。

---

## 1. 整体心智模型

```
┌──────────── Frontend (packages/app) ────────────┐
│                                                  │
│   useAgent ──ws.send {type:'chat'}──► Server     │
│      ▲                                  │       │
│      │ ws.message {type:'event'}        │       │
│      └─────────────────────┐            ▼       │
│                            │      handleChat()  │
│                            │            │       │
│                            │            ▼       │
│                            │      AgentContext  │
│                            │            │       │
│                            │            ▼       │
│                            └────  runAgent(ctx) ◄─── ★ 内核
│                                         │       │
│                                  AgentEvent yield
└──────────────────────────────────────────────────┘
```

两条心智线：

1. **agent runtime**：`runAgent(ctx)` 是状态机，输入 `AgentContext`，输出 `AsyncGenerator<AgentEvent>`。
   它对"是谁在调用"完全无感知 —— 没有 task / 没有 session / 没有持久化。

2. **server 桥接**：`server/main.ts` 唯一职责就是把 `runAgent` 的事件流通过 WebSocket 喂给前端，
   把前端的 `chat` / `abort` / `permission_response` 消息翻译成对 runtime 的调用。

---

## 2. 目录结构与职责

```
src/
├── index.ts                  # 仅导出前端需要的 public types(白名单导出)
│
├── agent/                    # ★ 推理内核 —— 唯一直接驱动 LLM 的层
│   ├── loop.ts               # runAgent 状态机骨架(while + 显式 transition)
│   ├── state.ts              # AgentLoopState + Transition 联合类型
│   └── context.ts            # AgentContext: runAgent 的唯一入参
│
├── tools/                    # 工具系统 —— 内核外部最重要的扩展面
│   ├── types.ts              # ToolDefinition / RiskLevel / toSDKTools()
│   ├── permission.ts         # withPermissionGate(危险工具的审批门控)
│   ├── registry.ts           # 默认工具集(getDefaultTools)
│   └── packages/             # 具体工具实现(bash / file_* / grep / docx_* / xlsx_* / pdf_*)
│
├── sandbox/                  # @anthropic-ai/sandbox-runtime 适配层
│   ├── manager.ts            # SandboxManager(单次 init + wrapCommand + violations)
│   └── config.ts             # the-next 配置 → SandboxRuntimeConfig 的翻译
│
├── server/                   # bun ws server —— 唯一对外接口
│   ├── main.ts               # Bun.serve: REST(config) + WS(chat / abort / permission)
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
types  ◄─  llm/sandbox/tools  ◄─  agent  ◄─  server
```

`types/` 是叶子，不能 import 任何业务模块。`agent/` 不能反过来 import `server/`。
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

## 4. AgentContext —— 唯一入参

```ts
type AgentContext = {
  readonly taskId?: string                  // 仅用于日志关联,不参与 runtime 决策
  readonly config: AgentConfig
  readonly messages: readonly Message[]
  readonly tools?: ToolSet
  readonly abort?: AbortController
}
```

`runAgent(ctx)` 不持有任何全局状态，所有依赖都从 `ctx` 拿。
要给 agent 传新东西（如 turn-scoped 能力面、stop hook、memory），**先扩 `AgentContext`**。

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

### 内置工具

`tools/registry.ts:getDefaultTools()` 返回的全集（chat 模式默认全开放）：

| 工具 | 风险 | 用途 |
|------|------|------|
| `file_read` | safe | 读文件,带行号,支持 offset/limit 分块 |
| `file_write` | write | 写文件,自动建父目录 |
| `grep` | safe | 正则搜索,优先 ripgrep,fallback 到 grep |
| `bash` | 函数 | 执行 shell,sandbox 包装,危险命令需审批 |

就这 4 个 —— 最小但完备的 agent 工具集(文件读写 + 搜索 + shell)。
对 OS 交互足够,对 office 文档处理不足(需要的话自己写 docx/xlsx/pdf 工具放进 `tools/packages/` 并注册)。

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

注册：在 `tools/registry.ts:builtinTools` 数组里加上即可。

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

### Server WS 协议

```ts
type ClientMessage = ChatRequest | AbortRequest | PermissionResponse
type ServerMessage = EventMessage | ReadyMessage | ErrorMessage
```

- `ChatRequest{ id, messages }`：发起一次对话，server 用 `id` 路由后续 event 单播回去。
- `AbortRequest{ id }`：中止该 id 对应的对话。
- `PermissionResponse{ permissionId, approved }`：响应 dangerous 工具的审批请求。
- `EventMessage{ id, event }`：单条 AgentEvent（按 `id` 单播）。
- `ReadyMessage`：连接建立后第一条，告知前端 server 就绪。
- `ErrorMessage{ id, error }`：处理失败的兜底响应。

---

## 7. Server 入口

`server/main.ts` 是唯一对外接口（给 tauri webview / 任何 http client）。

### REST 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config` | GET/POST | AgentConfig 读写（apiKey 返回时 mask） |
| `/api/config/full` | GET | 完整配置（含明文 key，仅本机用） |
| `/` | GET | 健康检查 + 版本号（前端 `discoverServer` 探测用） |

### WS 端点

`/ws` 一条连接，按 `id` **单播**（不广播），避免多 tab 串台。

### 启动流程

```
startServer()
  ├─ SandboxManager.init(config)        # 失败不抛,降级跑
  └─ Bun.serve({ ... })                 # 自动找 3001-3010 可用端口
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

## 9. 已经砍掉的东西（避免重新长出来）

历史上 core 还包含 `task/` 一层（task model / router / toolkit / executor / store / scheduler / logger）
和对应的 server REST/WS 端点。**这一坨已经全部移除**，原因是它属于业务壳，应该长在外层而不是 core 里。

如果未来需要"task 化"的能力（持久化对话、定时任务、background 执行、按场景装配工具集等），
**正确的姿势是另起一个 package（比如 `@the-next/task`）依赖 `@the-next/core`**，
而不是把 task 重新塞回 core。这样 core 永远保持"agent runtime + 工具 + server"三件套的最小完备性。

参考资料：原 task 层的设计动机和拆分思路在 git 历史里能找到（删除前的 `packages/core/src/task/*`），
重做时建议沿用而不是发明新模型。

---

## 10. 给 AI agent 的硬约束

工作时必须遵守：

1. **使用 Bun**：项目已统一 Bun 工具链。`Bun.file`、`Bun.spawn`、`Bun.$` 优先于 node 等价物。详见根目录 `CLAUDE.md`。

2. **类型先于实现**：所有跨模块边界必须经过 `types/` 或本模块的 type 文件。新增 event 先扩 `types/event.ts:AgentEvent`，新增 transition 先扩 `agent/state.ts:Transition`。

3. **不要在 loop 里写工具特判**：`if (toolName === 'xxx')` 这种逻辑不该出现在 `agent/loop.ts` 里。工具差异化处理由工具自己的 `execute` 完成，必要时往 ToolDefinition 加扩展字段。

4. **不要 mutate state**：`AgentLoopState` 是 readonly，每次循环结束 `state = { ...new }`。

5. **public types 白名单**：`src/index.ts` 只导出前端真用得到的类型。**不要把内部实现细节（`AgentLoopState`、`Transition`、`ToolDefinition`、`SandboxManager` 等）暴露给前端**——它们演进时不需要考虑前端兼容性。

6. **Risk 默认 `write`**：新工具如果不写 `riskLevel`，会默认 `write`（自动放行但留有提升通道）。读类工具记得显式标 `safe`。

7. **Sandbox 不可用 ≠ 失败**：所有 sandbox 调用必须降级安全，跑不起来就当透明（用户已经被启动日志告知）。

8. **不要在 core 里加业务壳**：core 不持有 sqlite、不写 JSONL、不调度 cron、不持久化对话。这些都属于"业务壳"，要做请另起包。

9. **改完跑 lint**：`bun run lint`（biome）。这个项目对未使用 import / 类型隐式 any 是零容忍。

---

## 11. 常见任务的入口

| 想做的事 | 改哪 |
|----------|------|
| 加新工具 | `tools/packages/<name>.ts` + 进 `tools/registry.ts:builtinTools` |
| 加新 agent 事件 | `types/event.ts:AgentEvent` 联合 + `agent/loop.ts:yield` + `useAgent` reducer |
| 加新状态机 transition | `agent/state.ts:Transition` 联合 + `agent/loop.ts` 处理分支 |
| 改 LLM provider | `llm/client.ts`（当前是 OpenAI compatible，可以扩多 provider 工厂） |
| 加新 REST 端点 | `server/main.ts:handleApiRequest` |
| 加新 WS 消息类型 | `server/protocol.ts:ClientMessage/ServerMessage` |
| 改 sandbox 策略 | `sandbox/config.ts:convertToRuntimeConfig` |
| 给 ctx 加新字段（如 hooks / memory） | `agent/context.ts:AgentContext` 联合 |
