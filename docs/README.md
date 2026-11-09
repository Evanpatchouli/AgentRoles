# AgentRoles 文档

AgentRoles 是一个本地优先的多角色 Agent 桌面工作台。本目录是使用、接入和维护文档的入口。

## 开始使用

- [项目 README](../README.md)：功能概览、快速开始、打包与常见配置
- [Notion 集成](notion.md)：创建任务、更新状态、属性映射与排查

## 外部 Agent 接入

- [接入总览](integrations.md)：HTTP API、MCP、CLI
- [MCP 接入指南](mcp.md)：Codex / Claude Code / DSH 的配置、工具能力与边界
- [多人使用与安全](multi-user.md)：共享 Token、并发、隔离与部署建议

## 运行与发布

- [架构说明](architecture.md)：数据模型、运行流程、存储、窗口与更新
- [发布与检查更新](release-and-update.md)：版本号、GitHub Release、新功能记录与更新检查
- [故障排查](troubleshooting.md)：MCP、模型、Notion、更新与窗口问题

## 文档检查

~~~bash
npm run docs:check
~~~

## 文档约定

- 文档以中文为主，代码、命令和字段名保持原样
- 示例中的 Token、API Key、路径都使用占位符
- 每篇文档标注适用版本和最后验证时间
- 外部链接通过系统浏览器打开；不要在应用内直接加载远程页面
