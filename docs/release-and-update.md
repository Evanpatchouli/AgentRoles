# 发布与检查更新

本文说明 AgentRoles 的版本发布、GitHub Release、检查更新、应用内自动更新和新功能记录机制。

- 适用版本：AgentRoles v0.1.6
- 最后验证：2026-11-17
- 相关文档：[文档索引](README.md) · [MCP 接入](mcp.md) · [故障排查](troubleshooting.md)

## 1. 版本号与发布日期

当前版本来自 `package.json` 的 `version`，运行时通过 `app.getVersion()` 读取。

关于弹窗中的「最新发布时间」在构建时注入，来源是 `package.json`：

~~~json
{
  "version": "0.1.6",
  "releaseDate": "2026-11-17"
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
2. 创建对应 tag，例如 `v0.1.6`
3. 创建 GitHub Release（不要只创建 tag）
4. 上传 setup `.exe` 安装包
5. 在 Release body 中写更新说明
6. 在 `resources/changelog.json` 顶部补一条同版本记录，供离线或接口失败时展示

Release body 建议固定格式：

~~~markdown
## 新功能

- ...

## 改进

- ...

## 修复

- ...
~~~

检查更新只把「名称以 `.exe` 结尾」的资产视为安装包，并优先选择名称含 `setup` / `install` 的那个。资产必须由 GitHub 提供 `digest`（`sha256:<64 位十六进制>`），自动更新依赖它做完整性校验；没有摘要的资产会被拒绝安装。

## 3. 检查更新

入口：

~~~text
标题栏更多菜单 → 帮助 → 检查更新
~~~

另外，**每次启动应用会在首屏加载约 2 秒后自动检查一次**：有新版时直接弹出更新窗口，无更新或检查失败时保持静默（只写日志），不打扰启动。自动化场景可用环境变量关闭：

~~~text
AGENTROLES_DISABLE_UPDATE_CHECK=1
~~~

流程：

1. 主进程请求 `releases/latest`（20 秒超时）
2. 读取 `tag_name`、`published_at`、`html_url`、`body` 和资产
3. 使用语义化版本比较当前版本与最新 tag
4. 有新版：弹出更新窗口，显示版本、发布时间、Markdown 说明与「立即更新」
5. 已是最新：提示「已是最新版本」
6. 仓库没有 Release：提示「项目暂未发布 Release」
7. 网络或接口失败：有缓存时回退到最近一次结果；无缓存时提示错误

### 接口限额与本地缓存

AgentRoles 使用未认证的 GitHub API，限额为每 IP 每小时 60 次。为减少请求：

- 启动时的自动检查命中 10 分钟内的本地缓存（`userData/update-check-cache.json`）时不再发起请求
- 其余请求携带 `If-None-Match`；内容未变化时返回 304，直接复用缓存结果
- GitHub 仅对带 `Authorization` 的 304 免除限额；本应用是未认证请求，304 仍计入 60 次/小时
- 接口限额（403/429）、5xx 或网络异常时回退到最近一次缓存结果
- 没有缓存时提示限额与预计恢复时间
- 手动检查与安装前复核会跳过 10 分钟节流，但仍使用条件请求

窗口底部按钮：

| 按钮 | 行为 |
| --- | --- |
| 立即更新 | 下载最新安装包，校验通过后静默安装并重启应用 |
| 稍后再说 | 仅关闭窗口；不下载、不记录「跳过此版本」，下次检查仍会提示 |

关闭按钮、Esc、点击遮罩与「稍后再说」等价；下载/校验/安装过程中窗口不可关闭。

## 4. 应用内自动更新（立即更新）

点击「立即更新」后由主进程完成全部步骤，渲染进程只展示进度：

1. **复核版本**：重新请求 `releases/latest`，确认仍是更高版本，避免使用过期信息
2. **选择资产**：setup/install 命名的 `.exe` → 任意 `.exe`；没有 `.exe` 时直接失败
3. **下载**：保存到系统临时目录 `agentroles-update/`，流式写入 `.partial` 临时文件
4. **校验**：边下载边计算 SHA-256，并要求
   - 下载地址与重定向后的地址都必须是 `https://github.com` 或 `*.githubusercontent.com`
   - 文件大小与 Release 资产声明一致
   - SHA-256 与资产 `digest` 完全一致
   - 文件头是 PE（`MZ`）
5. **安装**：校验通过后以 `/S --updated --force-run` 静默运行 NSIS 安装程序，随后应用退出
6. **重启**：安装器沿用原安装目录，安装完成后自动启动新版本

界面状态：

| 阶段 | 展示 | 可执行操作 |
| --- | --- | --- |
| 下载中 | 进度条、已下载 / 总大小、百分比 | 取消下载 |
| 校验中 | 「正在校验安装包（SHA-256）」 | 无（窗口不可关闭） |
| 安装中 | 「正在安装更新，应用即将自动重启」 | 无，应用随后退出 |
| 失败 | 具体原因 | 稍后再说 / 重试 |

失败时不会安装、不会退出，常见提示：

| 提示 | 原因 |
| --- | --- |
| 发布资产缺少 SHA-256 摘要 | Release 资产没有 `digest`，无法校验，拒绝安装 |
| 安装包校验失败（SHA-256 不匹配） | 下载内容与发布摘要不一致 |
| 更新下载地址不可信 | 资产地址不是 GitHub 的 https 地址 |
| 下载安装包失败（HTTP 404） | 资产被删除或网络异常 |
| 开发模式下不支持自动安装更新 | 当前是 `npm run dev` / 未打包运行 |
| 启动安装程序失败 | 安装器无法执行（权限、被杀软拦截等） |

安装包保存在系统临时目录，可随时手动删除；下一次更新会复用同名文件并覆盖。

## 5. 发布构建

版本确认后执行：

~~~bash
npm run release
~~~

`npm run dist:win` 与它等价。脚本 `scripts/release.mjs` 依次执行：

1. 读取 `package.json` 的 `version`
2. 清空并创建 `release/<version>/`
3. `electron-vite build` 构建主进程、preload 与渲染层
4. `electron-builder --win nsis --publish never -c.directories.output=release/<version>`
5. 为 `.exe` 与 `.blockmap` 生成 `SHA256SUMS.txt`
6. 打印产物大小与后续发布命令

产物示例（`release/0.1.6/`）：

~~~text
AgentRoles.Setup.0.1.6.exe
AgentRoles.Setup.0.1.6.exe.blockmap
SHA256SUMS.txt
latest.yml
win-unpacked/
~~~

安装包命名由 `electron-builder.yml` 的 `artifactName` 固定为 `${productName}.Setup.${version}.${ext}`，与检查更新使用的资产名保持一致。

## 6. 发布 GitHub Release

~~~bash
npm run release
git add -A
git commit -m "chore(release): 发布 v0.1.6"
git tag v0.1.6
git push origin main --tags
gh release create v0.1.6 release/0.1.6/AgentRoles.Setup.0.1.6.exe \
  --title "AgentRoles v0.1.6" --notes-file notes.md
~~~

发布后确认：

- Release 的 tag 与 `package.json` 的版本一致
- 资产名与本地产物一致，且 GitHub 已生成 `digest`（SHA-256）
- Release body 包含可读的更新说明

## 7. 新功能与更新记录

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

## 8. 未读圆点

- 应用启动后静默请求一次 Releases 列表（优先使用缓存）
- `localStorage` 保存已读版本：`agentroles.lastSeenReleaseVersion`
- 最新 Release 高于已读版本时，「新功能」右侧显示圆点
- 打开「新功能」并加载成功后，记录最新版本为已读
- 多窗口通过 `storage` 事件同步清除圆点
- 没有 Release 或使用内置 changelog 时，不会误显示未读圆点

## 9. 发布前检查

~~~bash
npm run typecheck
npm run test:all
npm run release
~~~

确认：

- [ ] `package.json` 的 `version` 已更新
- [ ] `package.json` 的 `releaseDate` 已更新
- [ ] `resources/changelog.json` 已补同版本条目
- [ ] GitHub Release tag 与版本一致
- [ ] setup `.exe` 已上传，且资产带 SHA-256 摘要
- [ ] Release body 包含可读的更新说明
- [ ] 当前仓库至少有一个 Release，或接受「暂无 Release」提示
- [ ] 安装包未签名时，发布说明中提醒 Windows 可能提示未知发布者
- [ ] 用上一版本安装包实测一次「立即更新」：下载、校验、静默安装、自动重启

## 10. 常见问题

| 现象 | 检查 |
| --- | --- |
| 一直提示暂无 Release | 是否创建了 GitHub Release，而不是只有 tag |
| 有 Release 但检查不到 | tag 是否为可比较的语义化版本，例如 `v0.1.6` |
| 新功能显示内置说明 | Release 列表为空、离线或接口失败；可点刷新 |
| 点击立即更新提示缺少 SHA-256 摘要 | Release 资产没有 `digest`；重新上传资产或重新创建 Release |
| 下载后校验失败 | 资产被替换、代理改写内容或下载不完整；重试或重新上传 |
| 点立即更新没有任何反应 | 是否运行的是未打包版本；打包版查看日志中的 `[updates]` 输出 |
| 安装完成但没有重启 | 安装器参数需包含 `--force-run`；检查是否有安全软件拦截 |
| 未读圆点不消失 | 打开新功能后是否成功加载；检查 localStorage 是否被清理 |
