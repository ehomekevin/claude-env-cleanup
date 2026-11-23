---
name: claude-env-cleanup
description: >-
  扫描并清理 macOS / Windows 上 Claude Desktop 与 Claude Code 的本地残留：设备指纹（ant-did 等）、Cookie/本地存储、
  ~/.claude.json 里的 userID 等跟踪字段、CLI 凭据与会话、系统日志缓存、Desktop 日志中的封禁/禁用痕迹（organization_disabled）、
  settings 备份文件里的旧凭据、中转/代理配置。备份策略由用户选择（U 盘 / 不备份），本机不留备份残留。
  当用户说"清理 Claude 环境 / 清理封号痕迹 / 重置 Claude 本地状态 / 检查 Claude 残留 / ban log / 换设备前清干净"时使用。
  提炼自 NeverBanned 的 detectClaudeLocalResidue 与 resetClaudeLocalState。
---

# Claude 本地环境清理

脚本：`scripts/claude_env_cleanup.cjs`（Node 18+，零依赖，支持 macOS 与 Windows）。

- macOS Desktop 数据目录：`~/Library/Application Support/Claude/`
- Windows Desktop 数据目录：`%APPDATA%\Claude`（即 `~/AppData/Roaming/Claude`）
- Keychain / defaults 仅 macOS；Windows 上自动跳过，其余功能一致

## 必须遵守的流程

1. **永远先只读扫描**，不要直接清理：
   ```bash
   node <skill目录>/scripts/claude_env_cleanup.cjs scan
   ```
   需要结构化结果时加 `--json`。扫描不写任何文件，不读取也不输出任何凭据、Cookie 内容或 Keychain 密码。

2. **把扫描结果用中文讲给用户**，按 6 类说明：Desktop 存储与设备 ID / 系统日志缓存 / CLI 身份与会话 / Keychain / 中转与代理配置 / 封禁痕迹（banTrace，只读检测日志中的 `organization_disabled` 等记录）。
   如果 `sessionAccounts >= 2`，明确提示"这台机器上留有多个账号的历史会话（多号关联高危）"。

3. **讲清后果并取得用户明确同意**后才能清理。必须告知：
   - 清理后 Claude Desktop 和 Claude Code **都会退出登录**，需要重新登录；
   - Desktop 的本地会话记录、CLI 的 `history.jsonl` / `transcripts` / `sessions` 会被移走（已备份，可还原）；
   - 清理只处理本机残留，**不能保证解封，也不能让已封账号恢复**。
   用户没有明确说"清理 / 确认"时，到此为止。

4. **确认 Claude 已完全退出**（Desktop 用 ⌘Q / 任务栏退出，所有终端里的 `claude` 都退出）。脚本检测到 Claude 进程会直接拒绝执行。

5. **清理前必须先问用户备份方式**（二选一，不要替用户决定）：
   - **A. 备份到 U 盘**：请用户插入 U 盘。clean 完成后，把 `~/.claude-env-cleanup-backups/<时间戳>` 整个目录**移动**（而非复制）到 U 盘，核对文件数量与大小一致后，**删除本机备份目录**。本机不留任何备份残留。
   - **B. 不备份，直接清理干净**：clean 完成后立即删除 `~/.claude-env-cleanup-backups/<时间戳>` 整个目录。必须先告知用户：删除后**无法还原**，清理是彻底的、不留残留。
   - 本机默认备份目录只是中转，无论选哪个，结束时本机都不应留下备份。

6. 执行清理：
   ```bash
   node <skill目录>/scripts/claude_env_cleanup.cjs clean --yes
   ```
   可选参数（仅在用户明确要求时加）：
   - `--keychain`：同时删除 Keychain 里的 `Claude Code-credentials`（CLI 登录凭据）
   - `--keychain-desktop`：同时删除 `Claude Safe Storage`（Desktop 的加密密钥，删除后 Desktop 本地加密数据全部失效）
   - `--keep-relay`：保留 `~/.claude/settings*.json` 里的 `ANTHROPIC_BASE_URL` 等中转变量

7. 按第 5 步用户的选择处理备份目录（移 U 盘 / 删除），然后跑一次 `scan` 复核，确认本机无残留备份。

## 还原

```bash
node <skill目录>/scripts/claude_env_cleanup.cjs restore --from <备份目录>
```
默认不覆盖已存在的文件（比如用户重新登录后生成的新文件）；确认要完整回到清理前状态时加 `--force`。
若备份已按第 5 步移到 U 盘或删除，需先接回 U 盘（`--from` 指向 U 盘路径），删除则不可还原。

## 会清理什么

| 位置 | 内容 |
| :--- | :--- |
| Desktop 数据目录（macOS：`~/Library/Application Support/Claude/`；Windows：`%APPDATA%\Claude`） | Cookies、Local Storage、IndexedDB、各类 Cache、`ant-did`、`ant-device-registry.json`、`ccd-ids.json`、`fcache`、历史账号会话目录、`logs/`（Desktop 日志，含封禁/禁用痕迹）等 |
| macOS `~/Library/{Logs,Caches,HTTPStorages,WebKit,Saved Application State,Preferences}` | 仅匹配 `Claude` / `com.anthropic.claudefordesktop*` / `claude-cli-nodejs` 的条目；另含 `~/.cache/claude`、`~/.local/state/claude` 和 defaults 域 `com.anthropic.claudefordesktop` |
| `~/.claude.json` | **白名单保留** `mcpServers` 与界面偏好，其余字段（`userID`、`oauthAccount` 等）全部移除 |
| `~/.claude/` | `.credentials.json`、`statsig`、`telemetry`、`sessions`、`history.jsonl`、`transcripts`、`shell-snapshots`、`policy-limits*`、`remote-settings*` 等 |
| `~/.claude/settings*.json*` | 只删 `env` 里的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`；**含 `settings.json.bak` 等备份文件中的旧凭据残留** |

## 永远不碰

macOS：`/Applications/Claude.app`（保住官方签名）。所有平台：`claude_desktop_config.json`（MCP 配置）、`~/.claude` 下的 `skills/`、`plugins/`、`agents/`、`commands/`、`projects/`、`CLAUDE.md`、`keybindings.json`，`~/.local/share/claude`（CLI 本体），Windows `%LOCALAPPDATA%\AnthropicClaude`（程序本体），以及任何日常浏览器数据。

`~/.zshrc` 等 shell 配置文件里的中转/代理变量**只报告不修改**，需要时告诉用户具体文件和行号，让用户自己处理。

## 边界

- 这是本机卫生工具，不是绕过平台风控的工具。不要把它包装成"封号后换新号继续用"的方案；Anthropic 使用政策禁止为规避检测创建多个账号。
- 浏览器端的硬件指纹（WebGL、Canvas 等）不存在于这些文件里，清理不会改变它们。
- 使用 `--home` 指向测试目录时，脚本自动跳过 Keychain、`defaults` 与进程检测。

## 自测

```bash
bash <skill目录>/scripts/selftest.sh
```
在临时假 HOME 里跑完 scan → 拒绝（无 `--yes`）→ clean → 白名单核验 → 复扫 → restore 全流程，应输出 `ALL PASS`。
