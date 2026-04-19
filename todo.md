# the-next 借鉴 Claude Code 的改造清单

参考 `we-can-learn-from-claude-code.md` 中"REPL 控制面 + Query Loop 状态机"两层判断，对当前 core agent 做的渐进改造。
按 ROI × 改造成本排序，每条独立可落地。

---

## P0 · Agent Loop 与工具回灌（最优先）

### 1. ★★★★★ Agent Loop 升格为显式状态机

**动机**
当前 `agent/loop.ts` 把"多轮工具回灌"完全交给 AI SDK 的 `streamText({ stopWhen: stepCountIs(10) })`，
runtime 看不到也无法干预 turn 之间的过渡。task-driven 形态下，长任务最容易死在 context 增长、
output 截断、模型偶发失败这些点上，而这些都是 SDK 黑盒里的事。

**改造范围**
- `packages/core/src/agent/loop.ts`
- `packages/core/src/agent/context.ts`(可能加 1-2 个字段)
- 新增 `packages/core/src/agent/state.ts`(AgentLoopState 类型)

**子任务**
- [ ] 定义 `AgentLoopState` 类型(messages、turnCount、recoveryCount、lastTransition、totalTokens 等)
- [ ] 定义 `Transition` 联合类型(`next_turn` / `recovery` / `compact` / `fallback` / `done`)
- [ ] 把 `runAgent` 改造成 `while (true)` 状态机骨架,每轮显式 `state = nextState(...)`
- [ ] 每个 transition 点 emit 一个 `RuntimeEvent`,前端能看到任务"健康度"
- [ ] 现有功能行为不变(只重构结构,不引入新能力)

**Done 标准**
- chat 和 task 跑通现有所有用例,事件流向前端的内容不少于现在
- TaskLogger 能记录每轮 transition 的 reason 和 turnCount
- 后续加新 transition 只需改 State + handler,不动循环骨架

---

### 4. ★★★★ 工具回灌做成显式 runtime 步骤

**动机**
当前工具结果由 SDK 内部回灌到下一轮模型,我们无法在中间做截断、注入 sandbox 注解、
按 budget 替换、记录文件快照等运行时决策。`executor.ts` 现在能"观察" tool_result 但无法"干预"。

**改造范围**
- `packages/core/src/agent/loop.ts`(配合 #1 的状态机)
- 可能新增 `packages/core/src/agent/tool-runner.ts`(把工具执行从 SDK 抽出)

**子任务**
- [ ] 单步采样:把 `streamText` 改为单 turn 调用(不让它自动执行工具)
- [ ] 显式 `runTools(toolCalls, ctx)` 函数,集中处理工具执行
- [ ] 工具结果经过 `normalizeToolResult` 协议化后再拼接进 `state.messages`
- [ ] 暴露"回灌前 hook":让 sandbox violations、size truncation 等都能在这里插入
- [ ] bash 工具的 `sandboxViolations` 注入逻辑从 `executor.ts` 的 onProgress 挪到 normalizeToolResult

**Done 标准**
- 所有工具调用都显式经过 `runTools`,不再依赖 SDK 自动多步
- `executor.ts` 的 `case 'tool_result'` 不再 `if (toolName === 'bash')` 这种特判
- 新增"回灌时拦截"是一个明确的扩展点,不需要改 loop

---

## P1 · 执行内核统一与协议归一

### 2. ★★★★★ 统一 chat 和 task 为同一执行内核

**动机**
当前 `server/main.ts:handleChat` 和 `task/executor.ts:executeTask` 是两条对称的流水线,
工具装配、system prompt 构建、loop 调用、事件分发都各写一遍。Claude Code 的做法是
"main session 本身就是一种 task",这样 background/foreground 切换、cowork 形态几乎免费拿到。

**改造范围**
- 新增 `packages/core/src/session/` 目录(Session 类型 + runSession 入口)
- `packages/core/src/server/main.ts`(handleChat 改为薄包装)
- `packages/core/src/task/executor.ts`(executeTask 改为薄包装)

**子任务**
- [ ] 定义 `Session` 类型:`{ id, kind: 'interactive' | 'task', taskId?, agentContext, abortController, isBackgrounded }`
- [ ] 实现 `runSession(session): AsyncGenerator<RuntimeEvent>`,统一装配 + 调 loop + 事件分发
- [ ] `handleChat` 改为创建 `kind: 'interactive'` 的 ephemeral session,不持久化
- [ ] `executeTask` 改为创建 `kind: 'task'` 的 session,持久化到 TaskStore
- [ ] 验证 chat 模式所有现有功能不退化(权限确认、abort、流式输出)

**Done 标准**
- `handleChat` 和 `executeTask` 加起来不超过 100 行(纯包装)
- 添加新模式(如"持续 chat 自动转 task")只需新增 session kind,不动 loop
- chat 也能 background(为后续 cowork 形态铺路)

---

### 5. ★★★ 控制面统一事件协议

**动机**
当前 `ServerMessage = EventMessage | TaskEventMessage | ReadyMessage | ErrorMessage`,
agent 事件和 task 事件是两套并列协议,前端 `useAgent` 和 `useTasks` 各维护一份 WS 连接。
缺少"控制面级别"的事件:能力面变更、权限解决、后台 task 通知、connection 降级、recovery 通知。

**改造范围**
- `packages/core/src/server/protocol.ts`(扩展 ControlPlaneEvent)
- `packages/app/src/hooks/`(合并 useAgent + useTasks 为 useControlPlane)
- `packages/core/src/server/main.ts`(broadcast 路径统一)

**子任务**
- [ ] 定义 `ControlPlaneEvent` 联合类型(覆盖 agent_event / task_event / capability_changed / permission_request / permission_resolved / task_notification / budget_warning / recovery_attempted / sandbox_violation)
- [ ] 服务端只 broadcast `ControlPlaneEvent`,前端只监听一个 stream
- [ ] 前端实现统一 reducer,从事件流派生:任务列表、当前能力、权限队列、失败状态
- [ ] 旧的 `EventMessage` / `TaskEventMessage` 可保留为 ControlPlaneEvent 的子集

**Done 标准**
- 前端只剩一个 WebSocket 连接和一个事件 reducer
- 控制面 UI 能从事件流完整重建状态(刷新页面 + 拉历史 = 完整恢复)
- 加新控制面信号只需扩 ControlPlaneEvent 联合 + 加 reducer 分支

---

## P2 · Recovery 与 Background 通知

### 6. ★★★ Background task 通知机制

**动机**
task-driven 形态下,用户提交 task 就走了。当 background task 完成时,如果用户在前台还在
chat 或在跑另一个 task,LLM 应该能"知道"任务 X 完成了、输出在 Y。Claude Code 用 XML
标签把通知注入下次上下文。

**改造范围**
- `packages/core/src/task/executor.ts`(完成时入队通知)
- `packages/core/src/session/`(下次会话开始时消费通知队列)

**子任务**
- [ ] 设计 `TaskNotification` 类型(taskId、status、summary、outputPath?)
- [ ] 实现 `enqueueTaskNotification` / `consumePendingNotifications` (内存队列即可)
- [ ] runSession 启动时把待消费通知注入为系统消息(用 XML 标签包裹)
- [ ] 前端用 toast / 任务列表角标展示完成通知
- [ ] task 完成时如果是 foreground 不注入(用户已经看到了)

**Done 标准**
- 跑 background task A,期间在 chat 里聊天,A 完成后下一轮 LLM 能感知到 A 的状态
- 多个 task 同时完成,通知按时间顺序注入

---

### 配套:简单 recovery 验证

**动机**
状态机骨架立起来后,实际加一个最简单的 recovery 用例,验证模式收益。
最容易复现的是 max output tokens 截断(现有 `maxTokens: 4096` 很容易碰到)。

**子任务**
- [ ] State 加 `recoveryCount` 字段,加 `MAX_RECOVERY_LIMIT = 3` 常量
- [ ] 检测到 output 截断时,emit `recovery_attempted` 事件,recoveryCount++,继续 loop
- [ ] 超过 limit 才转 error
- [ ] TaskLogger 记录每次 recovery 的原因和尝试次数

**Done 标准**
- 故意触发 max output 截断,task 能自动续跑而不是失败
- 控制面 UI 能看到"正在恢复(2/3)"

---

## P3 · 能力面动态装配

### 3. ★★★★ AgentContext 加入 turn-scoped 能力面装配

**动机**
当前 `AgentContext.tools` 是创建时一次性算好的。Claude Code 的 REPL 在用户每次提交时
重新合并工具池(`useMergedTools`)。对 task-driven 来说,这意味着可以"task 跑到一半临时
开启 web_search"、"MCP 工具热接入不重启 task"、"长 task 中途注入 skill"。

**改造范围**
- `packages/core/src/agent/context.ts`(加 `resolveCapabilities` 字段)
- `packages/core/src/task/toolkit.ts`(支持动态返回)
- `packages/core/src/agent/loop.ts`(每轮调用一次)

**子任务**
- [ ] AgentContext 增加 `resolveCapabilities: (state: AgentLoopState) => Promise<{ tools, systemPromptAddons, skills }>`
- [ ] 现有静态装配实现包装为 `staticCapabilities(tools)` 工厂
- [ ] loop 在 turn 开始时调一次 `resolveCapabilities`,emit `capability_changed` 事件(如果变化)
- [ ] 控制面 UI "当前能力面" 视图,展示本轮启用的工具列表

**Done 标准**
- 可以在 task 配置里声明"第 3 轮后启用 web_search"(或类似规则)并跑通
- 工具变更时前端能看到 capability_changed 事件

---

## 不在本轮范围

参考 Claude Code 但暂不学的设计:
- ContextCollapse / Microcompact / Snip 三层 compact(等真撞到 context 上限)
- Skill prefetch / memory prefetch(等长 task 多了再优化 latency)
- 多 model fallback(等接入第二个 provider)
- AsyncLocalStorage 包裹的 agentContext(单进程串行还用不到)
- Stop hooks / pre/post sampling hooks(等需要插件机制)

---

## 推荐顺序

```
P0-#1 状态机骨架     ─┐
P0-#4 工具回灌显式   ─┴─ 一起做,互为依赖
       ↓
P1-#2 统一执行内核   ─┐
P1-#5 控制面协议     ─┴─ 可并行
       ↓
P2 配套-简单 recovery     验证 P0 的状态机模式真带来收益
P2-#6 Background 通知     验证 P1 的统一执行内核能力
       ↓
P3-#3 turn-scoped 能力面   渐进增强
```
