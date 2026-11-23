# claude-env-cleanup

扫描并清理 macOS / Windows 上 **Claude Desktop** 与 **Claude Code** 的本地残留，备份策略由你选择（U 盘 / 不备份），支持一键还原。

提炼自 [NeverBanned](https://neverbanned.app) 的环境清理模块，独立运行，零依赖（Node 18+）。

既可以当作 **Agent Skill** 用（把整个文件夹交给 Claude Code / Antigravity / Codex / WorkBuddy 等 agent），也可以直接在终端里跑。

## 能做什么

| 命令 | 作用 |
| :--- | :--- |
| `scan` | 只读扫描。不写任何文件，不读取也不输出任何凭据、Cookie 内容或 Keychain 密码 |
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
| Keychain / defaults | ✓ | 自动跳过（无对应机制） |

## 作为 Agent Skill 安装

把整个文件夹放到对应位置即可：

| Agent | 位置 |
| :--- | :--- |
| Claude Code | `~/.claude/skills/claude-env-cleanup/` |
| WorkBuddy | `~/.workbuddy/skills/claude-env-cleanup/` |
| Antigravity（全局） | `~/.gemini/config/skills/claude-env-cleanup/` |
| Antigravity（单项目） | `<项目>/.agents/skills/claude-env-cleanup/` |

之后对 agent 说“帮我检查一下 Claude 本地残留”或“清理 Claude 环境”即可。SKILL.md 会约束 agent：先扫描，讲清后果并取得你确认，问清备份方式，才会清理。

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
