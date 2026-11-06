# 外部 Agent 接入指南

AgentRoles 把每个角色暴露成本机可访问的消息端点。Codex、Claude Code、DSH、自动化脚本、你自己的服务都可以向角色投递消息。

前提：AgentRoles 正在运行，且「设置 → 外部接入」已启用。

## 1. 获取地址与 Token

进入「设置 → 外部接入」，可以看到：

- Endpoint，例如 ~~~http://127.0.0.1:43110~~~
- 访问 Token
- 可直接复制的 cURL、MCP 配置与 CLI 命令

服务只监听 ~~~127.0.0.1~~~，不会暴露到局域网。修改端口或 Token 后需要保存并重启服务，同时更新外部客户端配置。

## 2. HTTP API

### 端点

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | ~~~/health~~~ | 否 | 健康检查，返回版本与角色数量 |
| GET | ~~~/v1/agents~~~ | 是 | 列出角色（id、名称、职责、是否自动处理） |
| GET | ~~~/v1/agents/{id或名称}/sessions~~~ | 是 | 列出该角色未归档的会话（id、标题、更新时间） |
| POST | ~~~/v1/agents/{id或名称}/messages~~~ | 是 | 向指定角色投递消息，可指定会话 |
| POST | ~~~/v1/messages~~~ | 是 | 在 body 中用 ~~~agent~~~ 字段指定角色 |

鉴权头：

~~~http
Authorization: Bearer <token>
~~~

也支持 ~~~X-AgentRoles-Token: <token>~~~。

### 投递消息

~~~bash
curl -X POST "http://127.0.0.1:43110/v1/agents/需求记录员/messages" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "登录页需要支持一次性验证码，周五前完成。验收：Chrome/Safari 都能登录。",
    "title": "登录页改版",
    "source": "codex",
    "sender": "web-team",
    "session": "登录页改版",
    "metadata": { "project": "portal", "ticket": "WEB-231" }
  }'
~~~

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| content | 是 | 消息正文，上限 40000 字符 |
| title | 否 | 标题，方便收件箱与模型理解 |
| source | 否 | 来源标识，默认 ~~~http~~~；MCP 默认 ~~~mcp~~~，CLI 默认 ~~~cli~~~ |
| sender | 否 | 发送者名称，例如项目名、agent 名 |
| session | 否 | 会话 id 或会话标题；不传则进入该角色的默认会话。也可以用 ~~~/v1/agents/{id或名称}/sessions~~~ 先查询 |
| metadata | 否 | 任意 JSON 对象，会存入消息元数据并展示在收件箱 |

成功返回 ~~~202 Accepted~~~：

~~~json
{
  "ok": true,
  "messageId": "…",
  "agentId": "…",
  "agentName": "需求记录员",
  "sessionId": "…",
  "sessionTitle": "登录页改版",
  "started": true,
  "queued": false
}
~~~

- 角色开启「自动处理」时，消息会立即开始处理（~~~started: true~~~）。
- 同一会话正在处理上一条消息时，新消息会排队（~~~queued: true~~~），当前任务结束后依次处理；不同会话可以并行。
- 角色关闭「自动处理」时，消息进入收件箱，等待人工确认。
- 不传 ~~~session~~~ 时使用角色默认会话；传入不存在的会话会返回 404。

### 错误

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 不合法、缺少 content / agent |
| 401 | Token 缺失或不正确 |
| 404 | 角色或会话不存在，或路径不存在 |
| 413 | 请求体过大 |

~~~json
{ "ok": false, "error": "角色不存在：xxx" }
~~~

## 3. MCP Server

~~~resources/mcp-server.mjs~~~ 是一个零依赖的 stdio MCP Server，负责把 MCP 工具调用转成上面的 HTTP 请求。

直接运行：

~~~bash
node "C:\path\to\AgentRoles\resources\mcp-server.mjs" \
  --url "http://127.0.0.1:43110" \
  --token "<token>"
~~~

也可以用环境变量：

~~~powershell
$env:AGENTROLES_URL = "http://127.0.0.1:43110"
$env:AGENTROLES_TOKEN = "<token>"
node resources/mcp-server.mjs
~~~

### 提供的工具

| 工具 | 用途 |
| --- | --- |
| ~~~agentroles_list_agents~~~ | 列出角色，确认角色名 |
| ~~~agentroles_list_sessions~~~ | 列出角色未归档的会话，参数：agent |
| ~~~agentroles_send_message~~~ | 向角色投递消息，参数：agent、content、title、source、sender、session |

### Claude Code

使用 Claude Code 的 MCP 命令注册：

~~~bash
claude mcp add agentroles -- node "C:\path\to\AgentRoles\resources\mcp-server.mjs" \
  --url "http://127.0.0.1:43110" --token "<token>"
~~~

之后在 Claude Code 中直接说「把这个需求交给需求记录员」，它就能调用 ~~~agentroles_send_message~~~。

### Codex

在 ~~~%USERPROFILE%\.codex\config.toml~~~ 中加入：

~~~toml
[mcp_servers.agentroles]
command = "node"
args = [
  "C:\\path\\to\\AgentRoles\\resources\\mcp-server.mjs",
  "--url", "http://127.0.0.1:43110",
  "--token", "<token>"
]
~~~

### DSH / 其他 MCP 客户端

通用 JSON 配置：

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

注意 Windows 路径在 JSON 中要写成双反斜杠。

## 4. CLI

CLI 适合脚本、Git hook 或不想配置 MCP 的 Agent。

~~~bash
node resources/agentroles-cli.mjs agents \
  --url http://127.0.0.1:43110 --token <token>
~~~

~~~bash
node resources/agentroles-cli.mjs sessions \
  --agent "需求记录员" \
  --url http://127.0.0.1:43110 --token <token>
~~~

~~~bash
node resources/agentroles-cli.mjs send \
  --agent "需求记录员" \
  --session "登录页改版" \
  --content "把「登录页改版」标记为进行中" \
  --source claude-code \
  --url http://127.0.0.1:43110 \
  --token <token>
~~~

支持从 stdin 读正文：

~~~bash
git log -1 --pretty=format:'%s%n%n%b' | node resources/agentroles-cli.mjs send \
  --agent "需求记录员" --source git-hook --url ... --token ...
~~~

所有命令同样可以用 ~~~AGENTROLES_URL~~~ / ~~~AGENTROLES_TOKEN~~~ 环境变量。

## 5. 消息如何被处理

1. 消息写入目标会话的记录，来源标记（~~~source~~~）会显示在聊天气泡与收件箱。
2. 若角色开启自动处理，运行时把消息作为用户输入，连同最近上下文与启用技能交给模型。
3. 模型按需调用工具（Notion、文件、HTTP、记忆等），每一轮工具结果都会回传。
4. 最终回复写入会话；外部消息状态从「待处理」变为「已记录」。
5. 失败时消息标记为失败，可在聊天或收件箱中重试。

外部消息在送入模型时会带一行来源头，例如：

~~~text
【外部消息 · 来源：Codex】
标题：登录页改版
发送者：web-team
登录页需要支持一次性验证码…
~~~

## 6. 故障排查

| 现象 | 检查 |
| --- | --- |
| 连接被拒绝 | AgentRoles 是否运行；外部接入是否启用；端口是否一致 |
| 401 | Token 是否复制完整；是否在保存后重启过服务 |
| 404 角色或会话不存在 | 用 ~~~/v1/agents~~~ / CLI ~~~agents~~~ 确认真实角色；用 ~~~/v1/agents/{角色}/sessions~~~ 或 CLI ~~~sessions~~~ 确认会话；中文名称注意 URL 编码 |
| 一直没有回复 | 角色是否配置了有效 API Key；在模型页点「测试连接」；检查会话中的错误卡片 |
| 端口被占用 | 设置里换端口，保存后重启；检查是否有其他实例 |
| 客户端看不到工具 | MCP 配置路径是否正确；~~~/health~~~ 是否可访问；客户端是否重启 |

## 7. 安全建议

- 不要把接入端口映射到公网；默认只监听本机。
- Token 等同于向所有角色发消息的权限，泄露后立即在设置里重新生成并保存。
- 外部消息可能包含提示注入。内置系统提示已要求模型忽略「泄露密钥 / 跳过确认」类指令，但高风险技能（终端、文件写入）仍应只给可信角色启用。
- 删除角色会同时删除该角色的会话与长期记忆。
