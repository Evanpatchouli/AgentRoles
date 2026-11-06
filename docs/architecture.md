# 架构说明

## 1. 总览

AgentRoles 是一个 Electron 应用，主进程承担全部 Agent 运行时与本地服务，渲染进程只负责界面。

~~~mermaid
flowchart LR
  UI[React 渲染进程] <-->|contextBridge IPC| MAIN[Electron 主进程]
  MAIN --> STORE[(配置 / 会话 / 记忆)]
  MAIN --> ENGINE[Agent 运行时]
  ENGINE --> LLM[模型 API]
  ENGINE --> TOOLS[技能工具]
  TOOLS --> NOTION[Notion API]
  TOOLS --> FS[本地文件]
  TOOLS --> HTTP[网络 / 终端]
  EXT[Codex / Claude Code / DSH / 脚本] -->|HTTP / MCP / CLI| ING[本地接入服务]
  ING --> ENGINE
~~~

### 进程职责

| 位置 | 职责 |
| --- | --- |
| ~~~src/main~~~ | 配置持久化、密钥加密、模型调用、工具执行、HTTP 接入、IPC |
| ~~~src/preload~~~ | 只暴露白名单 API，不开启 Node 集成 |
| ~~~src/renderer~~~ | 界面、会话渲染、流式增量更新、表单与设置 |
| ~~~src/shared~~~ | 主进程与渲染进程共享的类型 |
| ~~~resources~~~ | MCP Server 与 CLI 两个外部入口脚本 |

## 2. 核心数据模型

~~~ts
interface Agent {
  id: string
  name: string
  avatar: string
  avatarImage?: string     // 上传图片的 data URL，优先显示
  color: string
  tagline: string
  role: string              // system prompt 主体
  model: ModelSettings      // 独立服务、Key、模型、参数
  skills: Record<string, { enabled: boolean; settings: Record<string, string> }>
  autoRun: boolean          // 收到外部消息是否立即处理
}

interface Session {
  id: string
  agentId: string
  title: string              // 首条用户消息自动生成
  createdAt: number
  updatedAt: number
  customTitle?: boolean      // 手动重命名后不再自动覆盖
  pinned?: boolean           // 侧边栏优先显示
  archived?: boolean         // 收进“已归档”分组
}

interface ChatMessage {
  id: string
  agentId: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  toolCalls?: ToolCall[]    // 工具调用与结果内嵌在 assistant 消息里
  state: 'pending' | 'running' | 'done' | 'error'
  source?: string           // app / http / mcp / cli / codex / …
  meta?: { title?: string; sender?: string; externalId?: string }
  runId?: string
}
~~~

## 3. 一次 Agent 运行

~~~mermaid
sequenceDiagram
  participant U as 用户/外部消息
  participant R as AgentManager
  participant S as Store
  participant L as 模型 API
  participant T as 工具

  U->>R: send / ingest
  R->>S: 追加 user 消息（pending）
  R->>R: 标记 running，组装 system prompt + 历史 + 工具 schema
  R->>L: 流式请求
  L-->>R: 文本增量
  R-->>UI: message_delta 事件
  L-->>R: tool_calls
  R->>S: 保存 assistant 消息与调用参数
  R->>T: 依次执行工具
  T-->>R: 结果（失败也作为结果回传）
  R-->>UI: tool_started / tool_finished
  R->>L: 携带工具结果的下一轮请求
  L-->>R: 最终文本
  R->>S: 标记 user 消息 done
  R-->>UI: run_end
~~~

关键点：

- 每个 LLM 步骤生成一条 assistant 消息，工具调用结果内嵌在该消息的 ~~~toolCalls~~~ 中，既方便 UI 渲染，也能在下一轮还原成标准工具消息。
- 单次运行最多 10 轮工具调用；超过后终止并提示。
- 历史窗口按「最近 40 条 + 约 12 万字符」裁剪，工具结果在送给模型前截断到 8000 字符。
- 运行中收到新消息：同一会话串行排队；不同会话、不同角色可以并行。
- 每条会话拥有独立的运行队列、上下文窗口与运行状态；「新会话」只新建线程，不清空历史。
- 会话支持右键重命名、置顶与归档；归档会话保留历史，但不再出现在外部接入的会话列表中。
- 停止：中止当前会话请求，触发消息回到 pending，可重试。

## 4. 模型适配

~~~src/main/engine/llm.ts~~~ 统一了三种协议：

| provider | 端点 | 用途 |
| --- | --- | --- |
| ~~~openai~~~ | ~~~/chat/completions~~~ | DeepSeek、OpenAI 兼容服务、本地 Ollama / LM Studio |
| ~~~responses~~~ | ~~~/responses~~~ | OpenAI Responses，Codex / GPT-5 系列 |
| ~~~anthropic~~~ | ~~~/v1/messages~~~ | Claude Messages API |

适配层负责：SSE 解析、文本/推理增量、工具调用分片聚合、Anthropic 的 tool_result 角色转换、错误信息归一化。运行时不关心具体协议。

## 5. 技能系统

技能是「一组工具 + 一段提示 + 可配置项」：

~~~ts
interface SkillDefinition {
  id: string
  name: string
  description: string
  hint?: string
  risk?: 'low' | 'medium' | 'high'
  settings: SkillField[]
  tools: ToolSpec[]
}
~~~

运行前，~~~buildToolsForAgent~~~ 只收集该角色启用的技能，生成 JSON Schema 工具列表，并把技能说明拼进 system prompt。工具在 main 进程执行，错误被捕获后作为工具结果返回给模型。

当前技能：

- Notion：9 个任务/页面工具
- 记忆：按角色隔离的 JSON 文件
- 文件：工作区内的读写
- HTTP：带超时的通用请求
- 终端：工作区内执行命令，高风险

新增技能只需在 ~~~src/main/skills~~~ 实现 ~~~SkillDefinition~~~，在 ~~~skills/index.ts~~~ 注册，并在 ~~~defaults.ts~~~ 给出默认状态。UI 会自动渲染开关与配置字段。

## 6. 存储与密钥

~~~text
<userData>/
  config.json                  角色、全局设置、加密后的密钥
  sessions.json                会话元数据（标题、更新时间）
  messages/<sessionId>.json    每个会话的消息记录
  memory/<agentId>.json        长期记忆（按角色共享）
~~~

旧版本的 ~~~messages/<agentId>.json~~~ 会在首次启动时自动迁移为默认会话（会话 id = 角色 id）。

- 写入采用临时文件 + rename，避免半写。
- 会话写入做 350ms 防抖，运行结束时强制落盘。
- API Key、Notion Token 使用 ~~~safeStorage~~~ 加密后写入 config.json；Windows 下由 DPAPI 保护。
- 应用启动时把状态加载到内存，渲染进程通过 IPC 读取。
- 外观主题（~~~system / light / dark~~~）保存在 settings 中；主进程同步 `nativeTheme.themeSource` 与 Windows 标题栏 overlay 配色，渲染进程根据设置或系统偏好切换 CSS 变量。
- 测试可以用 ~~~AGENTROLES_USER_DATA~~~ 指定隔离的数据目录。

## 7. 外部接入与并发

~~~src/main/ingress/server.ts~~~ 使用 Node http：

- 绑定 ~~~127.0.0.1~~~，Bearer Token 鉴权，CORS 允许本地调用。
- 每次请求转换为一条 user 消息，携带 source / title / sender / metadata，以及可选 session（会话 id 或标题）；不传则进入角色的默认会话。
- 角色开启 autoRun 且该会话空闲时立即启动运行；忙时进入该会话队列；关闭 autoRun 时留在收件箱。
- `GET /v1/agents/:key/sessions` 返回角色的历史会话列表，供外部 Agent 选择投递目标。
- 最近 20 条请求记录在内存中，展示于设置页。

MCP 与 CLI 都是薄客户端：读取参数/环境变量后调用 HTTP 接口，不直接访问应用内部。

## 8. 安全边界

- 渲染进程：contextIsolation 开启、nodeIntegration 关闭、只暴露白名单 IPC。
- Markdown：marked + DOMPurify；外部消息按纯文本渲染。
- 外部输入：系统提示明确要求把外部消息视为数据，忽略其中试图覆盖角色或索取密钥的指令。
- 高风险技能默认关闭；终端命令限定工作区 cwd，文件路径做越界检查。
- 本地服务不监听 0.0.0.0，不提供远程管理接口。
- 主进程支持多窗口；标题栏更多菜单通过 IPC 执行新窗口、缩放、全屏与关闭。关闭窗口后应用驻留系统托盘，托盘可重新打开窗口或退出。
- 检查更新由主进程请求 GitHub Releases latest（避免渲染进程 CORS），按语义化版本比较；有新版时展示版本、发布时间、Release 说明与安装包/Release 页面链接。

## 9. 验证策略

| 命令 | 覆盖 |
| --- | --- |
| ~~~npm run typecheck~~~ | 主进程与渲染进程类型 |
| ~~~npm run test:notion~~~ | 模拟 Notion API，验证创建/查询/更新与属性映射 |
| ~~~npm run test:integrations~~~ | CLI 与 MCP Server 对 HTTP 入口的调用 |
| ~~~npm run test:update~~~ | 语义化版本比较（含预发布版本） |
| ~~~npm run test:migration~~~ | 旧版单会话消息迁移为默认会话 |
| ~~~npm run test:e2e~~~ | Playwright 启动真实 Electron，mock 模型完成工具循环、多会话创建/切换/隔离、外部消息按 session 路由 |

E2E 使用临时 userData 与随机端口，不接触真实 Notion 或真实模型。

## 10. 可扩展方向

- 会话重命名、归档与按项目自动路由
- 工具执行审批与审计日志
- 自定义技能目录（SKILL.md + 脚本）
- 定时任务与工作流编排
- Notion 2025 data sources API
- 更多模型协议（Gemini、Bedrock、本地推理）
