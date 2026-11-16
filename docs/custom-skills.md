# 自定义技能

本文说明如何把外部技能包（SKILL.md）导入 AgentRoles，并按角色启用。

- 适用版本：AgentRoles v0.1.1 及以后
- 最后验证：2026-11-16
- 相关文档：[架构说明](architecture.md#5-技能系统) · [故障排查](troubleshooting.md) · [多人使用与安全](multi-user.md)

## 1. 两种技能

| 类型 | 来源 | 提供什么 |
| --- | --- | --- |
| 内置技能 | 随应用发布，代码实现 | 工具 + 一段固定说明，例如 Notion、文件、HTTP、终端 |
| 自定义技能 | 用户导入的技能包 | SKILL.md 说明 + 参考文件；脚本需要终端技能配合 |

自定义技能适合承载「写作规范」「分析流程」「领域检查清单」这类以文字说明为主的技能。导入后它成为全局技能库的一员，每个角色可以独立启用或关闭。

## 2. 技能包格式

技能包是一个目录，根目录必须有 `SKILL.md`：

```text
my-skill/
  SKILL.md
  references/      可选，参考文档
  scripts/         可选，Python / Node 等脚本
  examples/        可选，示例
```

`SKILL.md` 使用 YAML frontmatter：

```markdown
---
name: my-skill
description: 一句话说明这个技能做什么、什么时候使用。
icon: "✦"           # 可选，界面图标
risk: medium        # 可选，low / medium / high
version: 1.0.0      # 可选
---

# 技能正文

这里写给模型看的工作方法、流程、判据和边界。
```

- `name` 决定技能 id：`custom:<slug>`；重新导入同名技能会覆盖更新。
- `description` 会出现在技能卡片和提示词里。
- frontmatter 缺失时，用目录名作为名称，用正文第一段作为说明。
- 正文可以引用包内相对路径，例如 `references/checklist.md`；模型用 `skill_read` 读取。

限制：最多 2000 个文件、单文件 8MB、解压后总计 64MB；自动跳过 `.git`、`node_modules`、`__pycache__` 等目录，不跟随符号链接。

## 3. 导入方式

入口：**角色 → 技能 → 自定义技能**。

| 方式 | 操作 | 说明 |
| --- | --- | --- |
| 本地文件夹 | 「导入本地技能」 | 选择技能包根目录，根部必须直接有 `SKILL.md` |
| GitHub 仓库 | 「从链接导入」→ 填仓库地址 | 自动下载默认分支的 ZIP |
| 仓库子目录 | 填 `https://github.com/owner/repo/tree/main/skills/foo` | 适合 monorepo 里的技能 |
| ZIP 链接 | 填任意 `http(s)://...zip` | 直接下载并解压 |

导入成功后：

- 文件保存在 `<userData>/skills/<slug>/`，并写入来源信息。
- 技能出现在「自定义技能」列表，默认不启用；打开开关并点「保存技能配置」才对当前角色生效。
- 重新导入同名技能会覆盖文件，但保留各角色的启用状态。
- 「打开技能目录」可以在文件管理器中查看；「删除技能」会删除文件并取消所有角色的启用。

## 4. 示例：导入「去 AI 味」技能

以 [lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone) 为例：

1. 打开任意角色 →「技能」→「自定义技能」。
2. 点「从链接导入」，填入：
   ```text
   https://github.com/larashero3-dotcom/lieflat-less-ai-tone
   ```
3. 导入后打开该技能开关，点「保存技能配置」。
4. 这个技能依赖 `scripts/detect.py` 等脚本。若要用脚本检测，请在同一个角色上同时启用「终端命令」技能。
5. 把待检测文稿放进工作区，然后对角色说：
   ```text
   用去 AI 味技能检测工作区里的 article.md，先给我检测报告，不要改稿。
   ```

技能正文里写的是相对路径（`scripts/detect.py`）。AgentRoles 会把技能目录的绝对路径写进提示词，模型调用终端时应当使用绝对路径，例如：

```bash
# Windows
python "C:\Users\<你>\AppData\Roaming\AgentRoles\skills\lieflat-less-ai-tone\scripts\detect.py" article.md --json

# macOS / Linux
python3 "/path/to/skills/lieflat-less-ai-tone/scripts/detect.py" article.md --json
```

Windows 上通常用 `python`，macOS / Linux 上通常是 `python3`。

## 5. 运行时行为

角色启用一个或多个自定义技能后：

- **提示词**：启用的技能说明会拼进 system prompt，包含技能目录、包内文件清单和正文。
- **工具**：自动提供两个只读工具，不需要额外配置：
  - `skill_list`：列出包内目录与文件。
  - `skill_read`：读取包内文本文件，用于参考文档和脚本源码。
- **脚本**：不会自动执行。只有同时启用「终端命令」技能，模型才能调用本机解释器运行包内脚本。
- **截断**：单个技能正文超过 24000 字符时会截断提示词，并提示模型用 `skill_read` 读取完整的 `SKILL.md`。

工具只对当前角色已启用的技能开放；读取路径限制在技能目录内，越界会被拒绝。

## 6. 存储位置

```text
<userData>/
  skills/
    <slug>/
      SKILL.md
      .agentroles.json   来源、导入时间等元数据
      references/
      scripts/
```

配置和会话仍然保存在 `config.json`、`sessions.json` 与 `messages/`。角色启用了哪些技能记录在 `config.json` 的 `agents[].skills` 中。

## 7. 安全边界

- 技能包是第三方内容。导入前先读一遍 `SKILL.md` 和脚本，确认没有你不希望执行的操作。
- 技能说明会进入提示词，等同于让作者给你的角色写工作指令；不要导入来源不明的技能。
- `skill_list` / `skill_read` 只读，不会写文件或执行命令。
- 脚本执行依赖「终端命令」技能；它拥有工作区内的命令执行能力，属于高风险开关。
- 删除技能会删除 `<userData>/skills/<slug>/` 下的文件，不可撤销；可以重新导入。

## 8. 排查

| 现象 | 检查 |
| --- | --- |
| 提示「根部没有 SKILL.md」 | 选择的是技能包根目录，而不是它的上级或子目录 |
| 提示「包含多个技能包」 | 在 URL 中加 `/tree/<分支>/<子目录>` 指向具体技能 |
| 下载失败（HTTP 404） | 仓库是否公开、分支名是否正确；私有仓库暂不支持 |
| 导入后看不到 | 刷新角色页；导入是全局技能库，但需要给当前角色打开开关并保存 |
| 模型没有按技能执行 | 技能是否已保存启用；正文是否过长被截断；必要时让模型先 `skill_read` 读 SKILL.md |
| 脚本跑不起来 | 是否启用「终端命令」；本机是否有 python / node；命令是否用了技能目录的绝对路径 |
| 删除后配置仍有残留 | 删除会清理所有角色的启用状态；多窗口需要刷新对应窗口 |
