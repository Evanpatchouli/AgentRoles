# 故障排查

本文按入口整理常见问题。更多配置细节见 [MCP 接入](mcp.md)、[接入总览](integrations.md) 和 [发布与检查更新](release-and-update.md)。

- 适用版本：AgentRoles v0.1.0
- 最后验证：2026-11-09

## 1. MCP / Codex 连不上

| 现象 | 检查 |
| --- | --- |
| 连接被拒绝 | AgentRoles 是否运行；设置 → 外部接入是否启用；端口是否一致 |
| 401 / unauthorized | Token 是否完整；保存设置后是否重启过外部接入 |
| 404 角色不存在 | 调用 `agentroles_list_agents` 确认名称或 id；中文名称注意 URL 编码 |
| 404 会话不存在 | 调用 `agentroles_list_sessions`；归档会话不可投递 |
| Codex 看不到工具 | MCP 配置路径、Node 路径、`--url`、`--token` 是否正确；重启 Codex |
| 其他电脑连不上 | 服务只监听 `127.0.0.1`，默认不支持远程直连 |
| 回执进入待处理队列 | 会话繁忙或角色关闭了自动处理；在 AgentRoles 中查看队列/收件箱 |
| 拿到了回执但没有回复 | MCP 只返回接收回执；最终回复在 AgentRoles 会话中，不能通过 MCP 读取 |

## 2. 角色收到了消息但不处理

1. 角色是否开启「自动处理」
2. 角色是否配置了有效模型、Base URL、Key 和模型名
3. 在「模型」页点击「测试连接」
4. 查看会话中的错误消息或工具失败卡片
5. 会话是否正在运行，后续消息是否在队列中
6. 是否触发了模型的速率限制或余额不足

## 3. 图片与文件附件

| 现象 | 检查 |
| --- | --- |
| 图片发送后模型报错 | 当前角色模型是否支持视觉/图片输入 |
| 拖入或粘贴没有反应 | 是否在聊天输入框区域；文件是否超过 8MB；是否已达 6 个附件或 20MB 总量 |
| 二进制文件模型读不到内容 | 文本、代码、Markdown、JSON、CSV 会读取文本；PDF 仅在支持文档的模型上传递；其他二进制只保留附件信息 |
| 图片预览模糊 | 图片会被压到最长边 1600px 并转为 WebP，避免占用过多上下文 |
| 发送后附件消失 | 附件已写入该条用户消息，可在消息气泡上方查看 |

## 4. Notion 失败

- Token 是否有效
- 数据库是否已共享给 Notion Integration
- 数据库 ID 是否正确
- 属性名和状态选项是否存在
- 角色是否启用了 Notion 技能
- 技能级数据库配置是否覆盖了全局配置

详见 [Notion 集成](notion.md)。

## 5. 检查更新 / 新功能

| 现象 | 检查 |
| --- | --- |
| 提示项目暂未发布 Release | GitHub 仓库是否创建了 Release，而不只是 tag |
| 有 Release 但检测不到 | tag 是否为 `vX.Y.Z` 形式的语义化版本 |
| 新功能显示内置说明 | Release 列表为空、离线或请求失败；可点弹窗右上角刷新 |
| 更新下载打开 Release 页面 | Release 中没有 setup `.exe` 资产 |
| 未读圆点不消失 | 打开新功能并成功加载；必要时清理 localStorage |
| 新功能数据不更新 | 6 小时缓存；点击刷新强制更新 |

## 6. 窗口与托盘

- 关闭窗口后应用驻留托盘，这是预期行为
- 托盘菜单可以重新打开主窗口、新建窗口或退出
- 如果托盘图标不可见，检查 Windows 托盘折叠区
- 关闭最后一个窗口后应用不退出；从托盘退出
- 多窗口共享配置、会话和外部接入

## 7. 数据和日志

数据目录：

- 设置 → 工作区与数据 → 打开数据目录
- 配置：`config.json`
- 会话：`sessions.json`、`messages/<sessionId>.json`
- 版本记录缓存：`releases-cache.json`
- 长期记忆：`memory/<agentId>.json`

不要在 Issue 中粘贴真实 Token、API Key、Notion Token 或包含隐私的会话内容。

## 8. 仍然无法解决

反馈时请提供：

- AgentRoles 版本
- Windows 版本
- 复现步骤
- 错误提示或截图
- 已脱敏的日志

GitHub Issues：

~~~text
https://github.com/Evanpatchouli/AgentRoles/issues
~~~
