# claude-env-cleanup

扫描并清理 macOS / Windows 上 **Claude Desktop** 与 **Claude Code** 的本地残留，备份策略由你选择（U 盘 / 不备份），支持一键还原。

提炼自 [NeverBanned](https://neverbanned.app) 的环境清理模块，独立运行，零依赖（Node 18+）。

既可以当作 **Agent Skill** 用（把整个文件夹交给 Claude Code / Antigravity / Codex / WorkBuddy 等 agent），也可以直接在终端里跑。

## 能做什么

| 命令 | 作用 |
| :--- | :--- |
| `scan` | 只读扫描。不写任何文件，不读取也不输出任何凭据、Cookie 内容或 Keychain 密码 |
| `netcheck` | 清理后的网络环境只读检测：IP 质量/类型、DNS 归属地、WebRTC/UDP 泄露（真实 STUN）、Cloudflare 挑战、IPv6、时区/语言对齐，并输出新开 Claude 前的前置调整建议 |
| `clean --yes` | 备份后清理。不加 `--yes` 拒绝执行；Claude 仍在运行时拒绝执行 |
| `restore --from <备份目录>` | 从备份还原，默认不覆盖已存在文件，加 `--force` 完整回滚 |

扫描覆盖 6 类：

1. **Desktop 存储与设备 ID**：`ant-did`、`ant-device-registry.json`、`ccd-ids.json`、Cookie/本地存储、历史账号会话目录等
2. **系统日志与缓存**（macOS）：`Library/Logs`、`HTTPStorages`、WebKit、defaults 等；全平台含 `~/.cache/claude`、`~/.local/state/claude`
3. **CLI 身份与会话**：`~/.claude.json` 跟踪字段、`.credentials.json`、`statsig` 等
4. **Keychain**（仅 macOS，只检测存在）
5. **中转与代理配置**：`ANTHROPIC_BASE_URL`、`HTTPS_PROXY` 等，**含 `settings.json.bak` 等备份文件里的旧凭据残留**
6. **封禁痕迹（banTrace）**：只读检测 Desktop 日志中的 `organization_disabled` / banned / deactivated 等记录

详细的清理范围与保护清单见 [SKILL.md](SKILL.md)。

## 备份策略（v0.2 新增）

本机的 `~/.claude-env-cleanup-backups/` 目录只是中转，两种收尾方式：

- **A. 备份到 U 盘**：清理后把备份目录移动到 U 盘，核对无误后删除本机副本
- **B. 不备份**：清理后直接删除备份目录，本机零残留（不可还原）

Agent skill 流程会在清理前让用户二选一；直接命令行使用时请手动处理备份目录。

## 网络环境检测（v0.2 新增）

```bash
node scripts/claude_env_cleanup.cjs netcheck
```

清理只解决"本机"残留，但新开 Claude 前还有网络层指纹要过关。`netcheck` 覆盖：

- **IP 质量/类型**：hosting（机房）/proxy（被标记代理）/mobile 标记、ISP、AS 归属（ip-api → ipwho.is → ipapi.co 多源兜底）
- **DNS 归属地**：系统解析器与 DoH 多路检测，判断 DNS 是否与出口同区（DNS 泄露）
- **WebRTC/UDP 泄露**：真实 STUN 绑定请求（与浏览器 WebRTC 同机制），看 UDP 出口是否绕过代理
- **Cloudflare 挑战**：claude.ai 直连是否被挑战 + cf trace 出口信息，并与常规出口交叉比对（多地区出口是强风控信号）
- **IPv6**：是否启用、公网出口归属地是否与 IPv4 出口一致
- **时区/语言对齐**：系统时区、locale 与 IP 所在时区/国家的偏差

输出包含逐条"前置调整建议"（换住宅 IP、关 IPv6、改系统时区/语言、禁用 WebRTC 等）。agent 按此流程使用时：先给建议清单，用户认可后才代为执行系统配置修改（需管理员权限的逐条确认）。

macOS 下 `netcheck` 会自动读取系统代理（`scutil --proxy`，如 Clash / Verge 的本地端口）并通过 HTTP CONNECT 走**与 Claude 相同的出口**——Node 默认忽略系统代理，不处理会测到直连 IP、结论失真。加 `--no-proxy` 可强制直连，用于对比代理前后的出口差异；IPv6 与 STUN/UDP 检测始终直连（UDP 不走 HTTP 代理）。

## 快速开始

```bash
git clone https://github.com/ehomekevin/claude-env-cleanup.git
cd claude-env-cleanup
# 1. 只读扫描
node scripts/claude_env_cleanup.cjs scan

# 2. 完全退出 Claude Desktop（macOS ⌘Q / Windows 任务栏退出）和所有终端里的 claude 后，执行清理
node scripts/claude_env_cleanup.cjs clean --yes

# 3. 处理备份目录：移动到 U 盘，或直接删除
# 4. 需要时还原（备份还在的话）
node scripts/claude_env_cleanup.cjs restore --from ~/.claude-env-cleanup-backups/<时间戳>
```

可选参数：`--json`（结构化输出）、`--keychain`（同时删 CLI 登录凭据）、`--keychain-desktop`（同时删 Desktop 加密密钥）、`--keep-relay`（保留 settings 中的中转变量）。

## 平台支持

| 功能 | macOS | Windows |
| :--- | :--- | :--- |
| Desktop 数据目录 | `~/Library/Application Support/Claude/` | `%APPDATA%\Claude` |
| 设备指纹 / Cookie / 会话清理 | ✓ | ✓ |
| Desktop 日志清理（含封禁痕迹） | ✓ | ✓ |
| 进程检测 | `ps` | `tasklist` |
| netcheck 出口 | 自动走系统代理（`scutil --proxy`） | 走环境变量代理 |
| Keychain / defaults | ✓ | 自动跳过（无对应机制） |

## 安装到主流 Agent

本仓库遵循 [Agent Skills](https://agentskills.io/specification) 开放规范（`SKILL.md` + 可选 `scripts/`），Claude Code、Codex、Cursor、Gemini CLI 等都能直接识别。安装方式二选一：

```bash
# 方式 A：社区标准 CLI（Node 22.20+，自动识别已安装的 Agent）
npx skills add ehomekevin/claude-env-cleanup -a claude-code

# 方式 B：本仓零依赖安装脚本（Node 18+，macOS / Linux / Windows）
node scripts/install.cjs --list                      # 查看各 Agent 的安装路径
node scripts/install.cjs --agent claude-code         # 装到用户级目录
node scripts/install.cjs --agent codex,cursor,gemini-cli
node scripts/install.cjs --agent codex --project .   # 装到当前项目的 .agents/skills
node scripts/install.cjs --agent claude-code --copy  # 复制而非符号链接（Windows 无权限时自动回退）
```

默认用**符号链接**，`git pull` 后立即生效；`--copy` 是复制一份，更新时需要重跑脚本。目标已存在且不是本 skill 的链接时会拒绝，加 `--force` 会先备份再替换。

| Agent | `--agent` | 全局路径 | 项目路径 |
| :--- | :--- | :--- | :--- |
| Claude Code | `claude-code` | `~/.claude/skills/` | `.claude/skills/` |
| Codex CLI | `codex` | `~/.agents/skills/` | `.agents/skills/` |
| Cursor | `cursor` | `~/.cursor/skills/` | `.agents/skills/` |
| Gemini CLI | `gemini-cli` | `~/.gemini/skills/` | `.agents/skills/` |
| GitHub Copilot | `github-copilot` | `~/.copilot/skills/` | `.agents/skills/` |
| OpenCode | `opencode` | `~/.config/opencode/skills/` | `.agents/skills/` |
| Antigravity | `antigravity` | `~/.gemini/config/skills/` | `.agents/skills/` |
| Windsurf | `windsurf` | `~/.codeium/windsurf/skills/` | `.windsurf/skills/` |
| Cline | `cline` | `~/.agents/skills/` | `.agents/skills/` |
| Continue | `continue` | `~/.continue/skills/` | `.continue/skills/` |
| Roo Code | `roo` | `~/.roo/skills/` | `.roo/skills/` |
| Qwen Code | `qwen-code` | `~/.qwen/skills/` | `.qwen/skills/` |
| Amp | `amp` | `~/.config/agents/skills/` | `.agents/skills/` |
| WorkBuddy | `workbuddy` | `~/.workbuddy/skills/` | `.workbuddy/skills/` |
| 通用 `.agents`（DSH 等） | `agents` / `dsh` | `~/.agents/skills/` | `.agents/skills/` |

> 路径按 2026-11 的 Agent Skills 规范与社区 [agent→path 表](https://github.com/vercel-labs/skills/blob/main/docs/agents.md)整理；Codex / Cursor / Gemini CLI / Copilot / OpenCode / Amp / Cline 等项目级目录共用 `.agents/skills`。安装后对 Agent 说“帮我检查一下 Claude 本地残留”或“清理 Claude 环境”即可，SKILL.md 会约束它先扫描、讲清后果并取得确认，再问备份方式，最后才清理。

## 清理后会怎样

- Claude Desktop 和 Claude Code 都会退出登录，需要重新登录；
- MCP 配置、`skills/`、`plugins/`、`projects/`、`CLAUDE.md`、应用本体签名都不会动；
- `~/.zshrc` 等 shell 配置只报告不修改。

## 边界

这是本机卫生工具：清理只处理本机文件残留，**不能保证解封，也不能恢复已封账号**。浏览器层面的硬件指纹（WebGL、Canvas 等）不在这些文件里，清理不会改变它们。请遵守 Anthropic 使用政策，不要用于为规避检测而创建或切换多个账号。

## 自测

```bash
bash scripts/selftest.sh
```

在临时假 HOME 中完整跑一遍 scan → 拒绝 → clean → 白名单核验 → 复扫 → restore（跨平台，含封禁痕迹与备份凭据用例），应输出 `ALL PASS`。

## License

[MIT](LICENSE) © 2026 ehomekevin
