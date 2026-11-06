# Notion 集成指南

AgentRoles 通过 Notion 官方 REST API 直接读写任务数据库，不依赖外部 MCP 服务。每个角色可以共用全局 Integration，也可以单独使用不同的 Token 与数据库。

## 1. 创建 Integration

1. 打开 <https://www.notion.so/my-integrations>，创建 Internal Integration。
2. 选择需要的工作区，复制 **Internal Integration Secret**（以 ~~~secret_~~~ 或 ~~~ntn_~~~ 开头）。
3. 在 AgentRoles「设置 → Notion 集成」粘贴 Token，点「测试 Notion」。

## 2. 准备任务数据库

在 Notion 中新建一个数据库（Table），推荐属性：

| 属性名 | 类型 | 用途 | 是否必需 |
| --- | --- | --- | --- |
| Name / 名称 | Title | 任务标题 | 必需 |
| Status / 状态 | Status 或 Select | 任务状态 | 推荐 |
| Priority / 优先级 | Select | 优先级 | 可选 |
| Due / 截止日期 | Date | 截止时间 | 可选 |

数据库可以自定义属性名。AgentRoles 会按名称自动识别，也可以在角色的 Notion 技能配置里指定属性名。

## 3. 把数据库共享给 Integration

这是最容易漏掉的一步：

1. 打开目标数据库页面。
2. 右上角「···」→「Connections / 连接」→ 添加刚创建的 Integration。
3. 确认 Integration 有编辑权限。

如果没有共享，API 会返回 404 或「Could not find database」。

## 4. 填写数据库 ID

从数据库链接中复制 32 位 ID：

~~~text
https://www.notion.so/workspace/1f2e3d4c5b6a7890abcdef1234567890?v=...
                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
~~~

可以直接粘贴整条链接，AgentRoles 会自动提取 32 位 ID。

- 「设置 → Notion 集成 → 默认任务数据库」：所有角色默认使用。
- 「角色 → 技能 → Notion 任务库 → 任务数据库 ID」：只覆盖这个角色。

## 5. 自动识别规则

创建任务时会读取数据库结构，并按以下顺序寻找属性：

| 目标 | 优先使用 | 自动匹配 | 兜底 |
| --- | --- | --- | --- |
| 标题 | 技能配置的标题属性 | 名称含 title / 标题 / 名称 | 第一个 Title 类型属性 |
| 状态 | 技能配置的状态属性 | 名称以 status / 状态 / stage / 阶段 开头 | 无（不会误用其他 Select） |
| 优先级 | 技能配置的优先级属性 | 名称含 priority / 优先级 / importance | 无 |
| 截止日期 | 技能配置的截止日期属性 | 名称含 due / deadline / 截止 / 到期 | 无 |

状态与优先级会按目标属性的真实类型生成 ~~~status~~~ 或 ~~~select~~~ 值，不会把 Select 的值写进 Status 属性。

### 状态选项

- **Status 类型**：值必须已经存在于数据库选项中。不存在时创建会被跳过并返回 warning，或在更新时直接报错，错误信息会列出可选值。
- **Select 类型**：Notion 允许在创建页面时自动新增选项。

如果状态值经常变化，建议在角色职责里要求模型先调用 ~~~notion_find_task~~~ 或 ~~~notion_get_database~~~ 确认可选值。

## 6. 工具

Notion 技能包含 9 个工具：

| 工具 | 说明 |
| --- | --- |
| ~~~notion_create_task~~~ | 推荐入口。自动映射标题/状态/优先级/截止日期，备注写入正文 |
| ~~~notion_update_task~~~ | 更新状态、优先级、日期、标题，追加正文 |
| ~~~notion_find_task~~~ | 按标题关键词或状态查询，更新前先定位 |
| ~~~notion_get_database~~~ | 读取属性名、类型与选项 |
| ~~~notion_query_database~~~ | 使用原生 Notion filter / sorts 查询 |
| ~~~notion_create_page~~~ | 原生 properties 创建页面 |
| ~~~notion_update_page~~~ | 原生 properties 更新页面 |
| ~~~notion_get_page~~~ | 读取页面属性与正文块 |
| ~~~notion_search~~~ | 在工作区搜索页面或数据库 |

工具结果会返回页面 id 与 URL；角色职责应要求模型把链接回传给用户。

## 7. 需求记录员示例

内置角色「需求记录员」的职责已经围绕这个流程写好：

1. 判断消息是新需求、进展、阻塞还是讨论。
2. 新需求调用 ~~~notion_create_task~~~。
3. 状态变化先 ~~~notion_find_task~~~，再 ~~~notion_update_task~~~。
4. 汇报结果并附链接，信息不足时列「待确认」。

可以在「角色 → 职责描述」里继续调整字段规范、任务粒度与状态命名。

## 8. 常见错误

| 错误 | 原因 | 处理 |
| --- | --- | --- |
| 404 Could not find database | 数据库没有共享给 Integration，或 ID 错误 | 在 Notion 页面 Connections 中添加 Integration |
| 401 Unauthorized | Token 错误或已被撤销 | 重新生成 Token |
| 400 property does not exist | 属性名配置错误 | 用 ~~~notion_get_database~~~ 查看真实属性名 |
| 400 Invalid status option | 用了 Status 类型里不存在的值 | 使用已有选项，或改用 Select 类型 |
| 429 rate limited | 请求过于频繁 | 稍后重试；减少无意义的查询 |

## 9. 安全

- Integration Token 可以读写被共享的页面。只共享任务数据库，不要共享包含敏感信息的页面。
- Token 在本地使用 Electron safeStorage 加密保存；界面里的 Token 默认隐藏。
- 外部 Agent 可能诱导模型写入错误内容。建议在角色职责里要求：不确定时先查询、删除/归档前必须确认。
