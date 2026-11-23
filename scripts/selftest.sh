#!/bin/bash
# 在临时假 HOME 中做正反双向实测：scan → clean 拒绝(无 --yes) → clean → 白名单核验 → scan 干净 → restore
set -u
S="$(cd "$(dirname "$0")" && pwd)/claude_env_cleanup.cjs"
H="$(mktemp -d /tmp/cec-test.XXXXXX)"
fail=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=1; }

D="$H/Library/Application Support/Claude"
mkdir -p "$D/Local Storage/leveldb" "$D/IndexedDB" "$D/claude-code-sessions/0123456789abcdef" "$D/claude-code-sessions/fedcba9876543210"
echo cookie > "$D/Cookies"; echo did > "$D/ant-did"; echo '{"mcpServers":{"x":{}}}' > "$D/claude_desktop_config.json"
mkdir -p "$H/Library/Logs/Claude" "$H/Library/Caches/com.anthropic.claudefordesktop" "$H/.cache/claude" "$H/Library/Logs/Other"
echo log > "$H/Library/Logs/Claude/main.log"; echo keep > "$H/Library/Logs/Other/x.log"
echo '{"userID":"u","oauthAccount":{"e":"a@b"},"mcpServers":{"m":{}},"theme":"dark"}' > "$H/.claude.json"
mkdir -p "$H/.claude/statsig" "$H/.claude/skills/my" "$H/.claude/projects"
echo c > "$H/.claude/.credentials.json"; echo h > "$H/.claude/history.jsonl"; echo s > "$H/.claude/skills/my/SKILL.md"
echo '{"env":{"ANTHROPIC_BASE_URL":"https://relay.example","FOO":"1"},"model":"opus"}' > "$H/.claude/settings.json"
printf 'export PATH=/x\nexport ANTHROPIC_BASE_URL=https://relay\n# export HTTPS_PROXY=x\n' > "$H/.zshrc"

out=$(node "$S" scan --home "$H" --json)
echo "$out" | grep -q '"clean": false' && ok "scan 检出残留" || bad "scan 检出残留"
echo "$out" | grep -q '"sessionAccounts": 2' && ok "scan 识别 2 个历史账号会话" || bad "scan 多账号"
echo "$out" | grep -q 'relay.example\|a@b' && bad "scan 泄露敏感值" || ok "scan 不输出敏感值"
echo "$out" | grep -q 'HTTPS_PROXY' && bad "scan 误报注释行" || ok "scan 跳过注释行"

node "$S" clean --home "$H" >/dev/null 2>&1 && bad "无 --yes 应拒绝" || ok "无 --yes 拒绝执行"
[ -f "$D/Cookies" ] && ok "拒绝后文件未动" || bad "拒绝后文件被改"

node "$S" clean --yes --home "$H" --json > "$H/clean.json" || bad "clean 执行失败"
[ ! -e "$D/Cookies" ] && [ ! -e "$D/ant-did" ] && [ ! -e "$D/claude-code-sessions" ] && ok "Desktop 残留已清" || bad "Desktop 残留未清"
grep -q mcpServers "$D/claude_desktop_config.json" && ok "Desktop MCP 配置保留" || bad "Desktop MCP 配置丢失"
[ ! -e "$H/Library/Logs/Claude" ] && [ -f "$H/Library/Logs/Other/x.log" ] && ok "系统日志精确清理、无关目录保留" || bad "系统日志清理"
node -e 'const j=require(process.argv[1]);process.exit(!j.userID&&!j.oauthAccount&&j.mcpServers&&j.theme==="dark"?0:1)' "$H/.claude.json" && ok ".claude.json 白名单保留" || bad ".claude.json 白名单"
[ ! -e "$H/.claude/.credentials.json" ] && [ -f "$H/.claude/skills/my/SKILL.md" ] && [ -d "$H/.claude/projects" ] && ok "~/.claude 凭据清理、skills/projects 保留" || bad "~/.claude 清理"
node -e 'const j=require(process.argv[1]);process.exit(!j.env.ANTHROPIC_BASE_URL&&j.env.FOO==="1"&&j.model==="opus"?0:1)' "$H/.claude/settings.json" && ok "settings 仅剥离中转变量" || bad "settings 剥离"
grep -q ANTHROPIC_BASE_URL "$H/.zshrc" && ok ".zshrc 未被修改" || bad ".zshrc 被修改"

BK=$(node -e 'console.log(require(process.argv[1]).backupDir)' "$H/clean.json")
[ "$(stat -f %Lp "$BK")" = "700" ] && ok "备份目录 0700" || bad "备份目录权限"

node "$S" scan --home "$H" --json | grep -q '"desktop": \[\]' && ok "清理后 Desktop 类为空" || bad "清理后复扫"

node "$S" restore --from "$BK" --home "$H" >/dev/null || bad "restore 执行失败"
[ -f "$D/Cookies" ] && [ -f "$D/ant-did" ] && [ -f "$H/Library/Logs/Claude/main.log" ] && ok "restore 还原 Desktop 与系统日志" || bad "restore 还原"
node -e 'const j=require(process.argv[1]);process.exit(j.mcpServers?0:1)' "$H/.claude.json" && ok "restore 未覆盖已存在文件(默认)" || bad "restore 覆盖"
node "$S" restore --from "$BK" --home "$H" --force >/dev/null && node -e 'const j=require(process.argv[1]);process.exit(j.userID==="u"?0:1)' "$H/.claude.json" && ok "restore --force 还原原 .claude.json" || bad "restore --force"

rm -rf "$H"
[ $fail = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
