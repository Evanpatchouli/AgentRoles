# 发布与检查更新

本文说明 AgentRoles 的版本发布、GitHub Release、检查更新和新功能记录机制。

- 适用版本：AgentRoles v0.1.0
- 最后验证：2026-11-09
- 相关文档：[文档索引](README.md) · [MCP 接入](mcp.md) · [故障排查](troubleshooting.md)

## 1. 版本号与发布日期

当前版本来自 `package.json` 的 `version`，运行时通过 `app.getVersion()` 读取。

关于弹窗中的「最新发布时间」在构建时注入，来源是 `package.json`：

~~~json
{
  "version": "0.1.0",
  "releaseDate": "2026-11-13"
}
~~~

`electron.vite.config.ts` 读取 `releaseDate`，通过 Vite `define` 注入 `__APP_RELEASE_DATE__`，主进程与渲染进程使用同一个值。未配置或格式不是 `YYYY-MM-DD` 时回退到构建当天。

发布新版本时，更新 `package.json` 的 `version` 和 `releaseDate` 后重新构建即可；不需要改源码常量。

## 2. GitHub Release 约定

检查更新读取：

~~~text
https://api.github.com/repos/Evanpatchouli/AgentRoles/releases/latest
~~~

新功能读取：

~~~text
https://api.github.com/repos/Evanpatchouli/AgentRoles/releases?per_page=20
~~~

发布时：

1. 将 `package.json` 的 `version` 提升到新版本
2. 创建对应 tag，例如 `v0.1.1`
3. 创建 GitHub Release（不要只创建 tag）
4. 上传 setup `.exe` 安装包
5. 在 Release body 中写更新说明

Release body 建议固定格式：

~~~markdown
## 新功能

- ...

## 改进

- ...

## 修复

- ...
~~~

检查更新会优先使用 setup 安装包资产；没有可用 `.exe` 时打开 Release 页面。

## 3. 检查更新

菜单入口：

~~~text
帮助 → 检查更新
~~~

流程：

1. 主进程请求 `releases/latest`
2. 读取 `tag_name`、`published_at`、`html_url` 和资产
3. 使用语义化版本比较当前版本与最新 tag
4. 有新版：弹出更新窗口，显示版本、发布时间、说明与「前往下载」
5. 已是最新：提示「已是最新版本」
6. 仓库没有 Release：提示「项目暂未发布 Release」
7. 网络或接口失败：提示错误，不修改本地状态

检查更新不会自动下载或静默安装；下载通过系统浏览器打开 Release 资产或页面。

## 4. 新功能与更新记录

菜单入口：

~~~text
帮助 → 新功能
~~~

流程：

1. 主进程请求 Releases 列表
2. 过滤 draft 和 prerelease，按语义化版本降序排列
3. 缓存到 `userData/releases-cache.json`，有效期 6 小时
4. 无 Release、离线或接口失败时读取：
   - 本地缓存
   - 内置 `resources/changelog.json`
5. 弹窗展示最近 5 个版本，可展开更早版本
6. Release body 通过 Markdown 渲染，链接走系统浏览器

缓存可以在弹窗右上角手动刷新，刷新会强制重新拉取。

## 5. 未读圆点

- 应用启动后静默请求一次 Releases 列表（优先使用缓存）
- `localStorage` 保存已读版本：`agentroles.lastSeenReleaseVersion`
- 最新 Release 高于已读版本时，「新功能」右侧显示圆点
- 打开「新功能」并加载成功后，记录最新版本为已读
- 多窗口通过 `storage` 事件同步清除圆点
- 没有 Release 或使用内置 changelog 时，不会误显示未读圆点

## 6. 发布前检查

~~~bash
npm run typecheck
npm run test:all
npm run build
npx electron-builder --win nsis -c.directories.output=release-build
~~~

确认：

- [ ] `package.json` 的 `version` 已更新
- [ ] `package.json` 的 `releaseDate` 已更新
- [ ] GitHub Release tag 与版本一致
- [ ] setup `.exe` 已上传
- [ ] Release body 包含可读的更新说明
- [ ] 当前仓库至少有一个 Release，或接受「暂无 Release」提示
- [ ] 安装包未签名时，发布说明中提醒 Windows 可能提示未知发布者

## 7. 常见问题

| 现象 | 检查 |
| --- | --- |
| 一直提示暂无 Release | 是否创建了 GitHub Release，而不是只有 tag |
| 有 Release 但检查不到 | tag 是否为可比较的语义化版本，例如 `v0.1.1` |
| 新功能显示内置说明 | Release 列表为空、离线或接口失败；可点刷新 |
| 更新下载打开的是 Release 页面 | Release 没有 setup `.exe` 资产 |
| 未读圆点不消失 | 打开新功能后是否成功加载；检查 localStorage 是否被清理 |
