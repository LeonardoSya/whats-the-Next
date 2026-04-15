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
├── server/          网络入口 + 工具链组装
├── agent/           Agent 循环（不感知工具细节）
├── tools/           工具定义（纯数据，不含运行时配置）
├── sandbox/         macOS Seatbelt 沙箱
├── llm/             LLM 连接
└── types/           全局类型定义
```

### 数据流

用户输入 → server/main.ts 构建 AgentContext → agent/loop.ts 驱动 LLM 多轮交互 → 工具执行 → 结果回传

### 工具链组装（在 main.ts 中完成）

```
getDefaultTools() → applySandbox() → toSDKTools(tools, approve)
```

registry 不知道 sandbox，bash 不知道 sandbox，sandbox 不知道权限。各层通过管道组合。

## 关键设计原则

### 1. AgentContext 收敛依赖

runAgent 只接受一个 AgentContext 对象。新增能力（signal、progress 等）加字段，不改签名。

### 2. loop 不感知工具系统

loop.ts 不 import 任何 tools/ 模块，只认 AI SDK 的 ToolSet 类型。工具的注册、格式转换、权限包装、沙箱包装全部在 server 层完成。

### 3. Handler Table 事件驱动

stream-handlers.ts 维护 SDK fullStream 事件 → AgentEvent 映射表。新增事件改表不改循环。

### 4. index.ts 最小暴露

仅导出前端实际消费的类型（AgentState、Message、RiskLevel）。core 内部模块直接 import 源文件，不经 index.ts。

### 5. 工具是纯定义

ToolDefinition 包含 name、description、parameters（Zod schema）、execute、riskLevel。工具本身不知道权限和沙箱的存在，这些由外层透明包装。

### 6. 权限 = 风险分级 + 透明拦截

riskLevel 支持固定值（`'safe'`）或函数（bash 按命令内容动态判断）。dangerous 级别通过 WebSocket Promise 桥接前端弹窗确认。

### 7. 沙箱 = 透明命令包装

applySandbox 替换 bash execute 中的 command，加 `sandbox-exec -f policy.sb` 前缀。macOS Seatbelt 内核级强制限制文件和网络访问。

## 文件职责速查

| 文件 | 职责 |
|------|------|
| `server/main.ts` | Bun HTTP+WS 服务，构建 AgentContext，组装工具链 |
| `server/protocol.ts` | WebSocket 消息类型定义 |
| `server/config.ts` | `~/.the-next/config.json` 读写 |
| `agent/context.ts` | AgentContext 类型 |
| `agent/loop.ts` | runAgent — 核心循环，消费 ToolSet |
| `agent/stream-handlers.ts` | SDK 事件 → AgentEvent 映射表 |
| `tools/types.ts` | ToolDefinition 接口 + toSDKTools 转换 |
| `tools/permission.ts` | withPermissionGate 权限拦截 |
| `tools/registry.ts` | getDefaultTools() 工具注册表 |
| `tools/packages/*.ts` | 具体工具实现 |
| `sandbox/policy.ts` | .sb 策略生成 |
| `sandbox/manager.ts` | SandboxManager + applySandbox |
| `llm/client.ts` | OpenAI Compatible provider |
| `types/event.ts` | AgentEvent 联合类型 |
| `types/message.ts` | Message 联合类型 |
| `types/config.ts` | AgentConfig |

## 新增工具的步骤

1. 在 `tools/packages/` 下创建文件，导出 `ToolDefinition` 对象
2. 在 `tools/registry.ts` 的 `builtinTools` 数组中注册
3. 设置 `riskLevel`（safe / write / dangerous 或函数）

## 新增 stream 事件的步骤

1. 在 `types/event.ts` 中定义新的事件类型，加入 AgentEvent 联合
2. 在 `agent/stream-handlers.ts` 的 streamHandlers 表中添加 handler
3. 前端 `useAgent.ts` 的 switch 中添加处理分支
