# AgentRoles MCP 接入指南

本文说明 Codex、Claude Code、DSH 等 MCP 客户端接入 AgentRoles 后的能力边界、配置方式与常见问题。

- 适用版本：AgentRoles v0.1.1
- 最后验证：2026-11-09
- 相关文档：[接入总览](integrations.md) · [多人使用与安全](multi-user.md) · [架构说明](architecture.md)

## 1. 它是什么

AgentRoles 的 MCP Server 是一个 **stdio 代理**：

~~~text
Codex / Claude Code / DSH
        │ stdio MCP
        ▼
resources/mcp-server.mjs
        │ 本地 HTTP + Bearer Token
        ▼
AgentRoles 主进程（127.0.0.1）
        │
        ▼
角色 Agent、模型与技能
~~~

MCP Server 本身不运行 Agent，也不直接访问 Notion 或文件系统。它只把 MCP 工具调用转发给 AgentRoles 的本地 HTTP 接口。

## 2. 前提

1. AgentRoles 正在运行
2. 设置 → 外部接入 已启用
3. 已获得接入端口和 Token
4. MCP 客户端能访问到本机的 `127.0.0.1:<端口>`

默认情况下，其他电脑不能直接连接这个端口；这不是一个公网服务。

## 3. 配置

### Codex

在 `%USERPROFILE%\.codex\config.toml` 中加入：

~~~toml
[mcp_servers.agentroles]
command = "node"
args = [
  "C:\\path\\to\\AgentRoles\\resources\\mcp-server.mjs",
  "--url", "http://127.0.0.1:43110",
  "--token", "<token>"
]
~~~

重启 Codex 后生效。

### Claude Code

~~~bash
claude mcp add agentroles -- node "C:\path\to\AgentRoles\resources\mcp-server.mjs" \
  --url "http://127.0.0.1:43110" --token "<token>"
~~~

### DSH / 其他 MCP 客户端

~~~json
{
  "mcpServers": {
    "agentroles": {
      "command": "node",
      "args": [
        "C:\\path\\to\\AgentRoles\\resources\\mcp-server.mjs",
        "--url", "http://127.0.0.1:43110",
        "--token", "<token>"
      ]
    }
  }
}
~~~

Windows 的 JSON 路径需要使用双反斜杠。

也可以用环境变量：

~~~powershell
$env:AGENTROLES_URL = "http://127.0.0.1:43110"
$env:AGENTROLES_TOKEN = "<token>"
node resources/mcp-server.mjs
~~~

## 4. 提供的三个工具

### agentroles_list_agents

列出可用角色：

- 名称与 id
- 一句话职责
- 是否自动处理消息
- 未归档会话数量

用于确认角色名，避免把消息发给错误角色。

### agentroles_list_sessions

参数：

- `agent`：角色名称或 id

返回该角色**未归档**会话的：

- 会话 id
- 会话标题
- 更新时间

不传 `session` 投递时，消息进入角色默认会话。归档会话不会出现在列表中，也不能被 MCP 投递。

### agentroles_send_message

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| agent | 是 | 角色名称或 id |
| content | 是 | 消息正文，建议写清背景、目标与验收标准 |
| title | 否 | 消息标题 |
| source | 否 | 来源标识，建议使用 `codex`、`claude-code`、`dsh` |
| sender | 否 | 发送者或项目名；这是自报字段，不是身份认证 |
| session | 否 | 会话 id 或标题；不传进入默认会话 |

示例：

~~~json
{
  "agent": "需求记录员",
  "content": "登录页需要支持一次性验证码，周五前完成。验收：Chrome 和 Safari 都能登录。",
  "title": "登录页改版",
  "source": "codex",
  "sender": "web-team",
  "session": "项目 A"
}
~~~

成功返回的是**接收回执**，例如：

~~~text
已接收：需求记录员（会话「项目 A」），消息 msg-xxx，已开始处理
~~~

或者：

~~~text
已接收：需求记录员，消息 msg-xxx，已进入待处理队列
~~~

它不会返回角色最终的回复内容。

## 5. 能力边界

| 能做 | 不能做 |
| --- | --- |
| 发现角色 | 读取角色最终回复 |
| 发现未归档会话 | 等待任务处理完成 |
| 投递需求、进展和上下文 | 创建、重命名、归档、删除会话 |
| 按会话投递 | 创建、修改、删除角色 |
| 让角色使用其已启用技能 | 直接调用 Notion、文件、HTTP、终端 |
| 通过 source/sender 标注来源 | 设置任意 metadata 或发送文件附件 |

### 单向投递

Codex 发出消息后，AgentRoles 异步处理，结果显示在 AgentRoles 的会话界面或收件箱中。当前没有 `get_messages` 或 `wait_result` 工具，因此 Codex 不能自动读取结果并继续推理。

### 自动处理与队列

- 角色开启「自动处理」且该会话空闲：立即开始，回执为「已开始处理」
- 同一会话正在运行：进入该会话队列，回执为「已进入待处理队列」
- 角色关闭「自动处理」：消息进入待处理收件箱，等待人工确认
- 不同会话可以并行；同一会话串行

### 技能与权限

Codex 不能直接调用角色的 Notion、文件、HTTP 或终端工具。它只能把消息交给角色，由角色按自己的职责、模型和技能配置决定是否使用这些能力。

这也意味着：

- 共享角色启用 `run_command`、文件写入等高风险技能时，要信任所有能向它发消息的人
- 外部消息应被视为数据；角色提示词仍可能受到恶意内容影响
- 不要把 Token 和 MCP 配置发给不可信的人

多用户场景请继续阅读 [多人使用与安全](multi-user.md)。

## 6. 常见问题

| 现象 | 检查 |
| --- | --- |
| 连接被拒绝 | AgentRoles 是否运行；外部接入是否启用；端口是否正确 |
| 401 | Token 是否完整；保存设置后是否重启过外部接入 |
| 404 角色不存在 | 用 `agentroles_list_agents` 确认角色名或 id |
| 404 会话不存在 | 用 `agentroles_list_sessions` 确认未归档会话 |
| 回执是“进入待处理队列” | 该角色/会话正在运行，或角色关闭了自动处理 |
| 一直没有回复 | 角色是否配置了可用模型和 API Key；在 AgentRoles 中查看错误卡片 |
| 多人同时投递后很慢 | 同一会话串行处理，消息会排队；可以为不同项目使用不同会话 |
| 归档会话找不到 | 归档会话不会出现在 MCP 会话列表中，需要先在 UI 取消归档 |
| 无法读取 Codex 期望的结果 | 当前 MCP 只有投递能力，没有结果回读工具 |

## 7. 安全底线

- 服务只监听 `127.0.0.1`，不要直接把端口暴露到公网
- Token 等同于消息投递权限，所有持有者共享全部角色和会话
- `source`、`sender` 可伪造，不能用于权限判断
- 高风险技能默认关闭；共享角色应使用最小权限
- 多人、远程或公网部署前，请先阅读 [多人使用与安全](multi-user.md)
