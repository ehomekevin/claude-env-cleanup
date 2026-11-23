#!/usr/bin/env node
/*
 * claude-env-cleanup — Claude Desktop / Claude Code 本地环境残留扫描与清理（macOS / Windows）
 *
 * 提炼自 NeverBanned 的 detectClaudeLocalResidue / resetClaudeLocalState，独立运行，零依赖。
 *
 * 用法：
 *   node claude_env_cleanup.cjs scan [--json]                     只读扫描（默认）
 *   node claude_env_cleanup.cjs clean --yes [--keychain] [--keychain-desktop] [--keep-relay] [--json]
 *   node claude_env_cleanup.cjs restore --from <备份目录> [--force] [--json]
 *   通用：--home <dir>  指定 HOME（测试用；非真实 HOME 时自动跳过 Keychain/defaults）
 *
 * 安全约束：
 *   - scan 绝不写入任何文件，绝不读取/输出任何凭据、Cookie 内容或 Keychain 密码。
 *   - clean 必须显式 --yes；Claude Desktop / CLI 仍在运行时拒绝执行（防退出时回写旧 ID）。
 *   - clean 前先把所有将被删除/改写的文件完整备份到 0700 目录，可用 restore 还原。
 *   - 永不触碰：/Applications/Claude.app、claude_desktop_config.json（MCP）、~/.claude/settings.json 的非中转字段、
 *     keybindings.json、skills/、plugins/、agents/、commands/、CLAUDE.md、~/.local/share/claude（CLI 本体）、日常浏览器。
 *   - shell rc 文件（~/.zshrc 等）里的中转变量只报告，不自动改。
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const DESKTOP_RESET_TARGETS = [
  "Cookies", "Cookies-journal", "Network", "Partitions", "Service Worker", "Shared Dictionary", "databases",
  "Storage", "CacheStorage", "Local Storage", "Session Storage", "IndexedDB", "Extension State", "Cache",
  "Code Cache", "GPUCache", "GPUPersistentCache", "DawnGraphiteCache", "DawnWebGPUCache", "GraphiteDawnCache",
  "Network Persistent State", "TransportSecurity", "DIPS", "DIPS-wal", "DIPS-shm", "SharedStorage",
  "SharedStorage-wal", "Trust Tokens", "Trust Tokens-journal", "Preferences", "Local State", "Visited Links",
  "WebStorage", "blob_storage", "SessionData", "sentry", "Crashpad", "config.json", "window-state.json",
  // Anthropic Desktop 持久设备 ID、策略缓存与旧账号会话
  "ant-did", "ant-device-registry.json", "ccd-ids.json", "buddy-tokens.json", "fcache", "plan-usage-history.json",
  "declarative_performance_observer.db", "declarative_performance_observer.db-journal", "claude-code-sessions",
  "local-agent-mode-sessions", "side-session-notes", "spaces-present", "cowork-memory-resets.json",
  "cowork-enabled-cli-ops.json", "remote-file-download-parts.json",
  // Desktop 日志：本机封禁/禁用记录（organization_disabled 等）的主要藏身处
  "logs",
];
const DESKTOP_KEY_LABELS = {
  "ant-did": "ant-did（设备指纹）",
  "ant-device-registry.json": "ant-device-registry.json（设备注册）",
  "ccd-ids.json": "ccd-ids.json（设备 ID）",
  fcache: "fcache（策略缓存）",
  "claude-code-sessions": "claude-code-sessions（历史账号会话）",
  "local-agent-mode-sessions": "local-agent-mode-sessions（历史账号会话）",
  logs: "logs（Desktop 日志，含封禁/禁用痕迹）",
};
const DESKTOP_PRESERVE = "claude_desktop_config.json";

const CLAUDE_JSON_PRESERVE_KEYS = new Set([
  "mcpServers", "theme", "preferredNotifChannel", "keybindings", "editorMode", "verbose", "autoUpdates",
  "autoUpdatesProtectedForNative", "shiftEnterKeyBindingInstalled", "terminalProgressBarEnabled",
]);

const DOT_CLAUDE_RESET_TARGETS = [
  ".credentials.json", ".last-cleanup", "backups", "statsig", "telemetry", "session-env", "sessions",
  "history.jsonl", "transcripts", "shell-snapshots", "paste-cache", "spares", "file-history", "downloads",
  "cache", "ide", "policy-limits.json", "policy-limits.json.signature.json", "policy-limits.json.stamp.json",
  "remote-settings.json", "remote-settings.json.signature.json", "remote-settings.json.synced-at",
];

const RELAY_ENV_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"];
const SHELL_RC_FILES = [".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".profile"];

const SYSTEM_CACHE_SPECS = [
  { relDir: path.join("Library", "Logs"), prefix: "Claude", exact: true },
  { relDir: path.join("Library", "HTTPStorages"), prefix: "com.anthropic.claudefordesktop" },
  { relDir: path.join("Library", "Caches"), prefix: "com.anthropic.claudefordesktop" },
  { relDir: path.join("Library", "Caches"), prefix: "claude-cli-nodejs", exact: true },
  { relDir: path.join("Library", "Saved Application State"), prefix: "com.anthropic.claudefordesktop.savedState" },
  { relDir: path.join("Library", "WebKit"), prefix: "com.anthropic.claudefordesktop" },
  { relDir: path.join("Library", "Preferences"), prefix: "com.anthropic.claudefordesktop.plist" },
  { relDir: ".cache", prefix: "claude", exact: true },
  { relDir: path.join(".local", "state"), prefix: "claude", exact: true },
];

const KEYCHAIN_CLI = "Claude Code-credentials";
const KEYCHAIN_DESKTOP = "Claude Safe Storage";
const DEFAULTS_DOMAIN = "com.anthropic.claudefordesktop";
const ACCOUNT_DIR_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8,64})$/i;

// ---------------------------------------------------------------- helpers

function parseArgs(argv) {
  const args = { cmd: "scan", flags: new Set(), home: null, from: null };
  const rest = argv.slice(2);
  if (rest[0] && !rest[0].startsWith("--")) args.cmd = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--home") args.home = rest[++i];
    else if (a === "--from") args.from = rest[++i];
    else args.flags.add(a);
  }
  return args;
}

function resolvePaths(homeOverride) {
  const home = path.resolve(homeOverride || os.homedir());
  const platform = process.platform;
  const isRealHome = home === path.resolve(os.homedir());
  const desktopDir =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Claude")
      : path.join(home, "AppData", "Roaming", "Claude"); // Windows（测试假 HOME 亦沿用同一约定）
  return {
    home,
    platform,
    isRealHome,
    desktopDir,
    claudeJson: path.join(home, ".claude.json"),
    dotClaude: path.join(home, ".claude"),
    backupRoot: path.join(home, ".claude-env-cleanup-backups"),
  };
}

function lexists(p) {
  try { fs.lstatSync(p); return true; } catch (_) { return false; }
}

function isRealDir(p) {
  try { const st = fs.lstatSync(p); return st.isDirectory() && !st.isSymbolicLink(); } catch (_) { return false; }
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return undefined; }
}

function listSystemCacheHits(home) {
  const hits = [];
  for (const spec of SYSTEM_CACHE_SPECS) {
    const dir = path.join(home, spec.relDir);
    if (!isRealDir(dir)) continue;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of names) {
      const ok = spec.exact ? name === spec.prefix : name === spec.prefix || name.startsWith(spec.prefix);
      if (ok) hits.push({ abs: path.join(dir, name), rel: path.join(spec.relDir, name) });
    }
  }
  return hits;
}

// ~/.claude 下所有 settings*.json*（含 settings.json.bak 等备份残留）
function settingsCandidateFiles(dotClaude) {
  const names = [];
  try {
    for (const n of fs.readdirSync(dotClaude)) {
      if (/^settings.*\.json/i.test(n)) names.push(n);
    }
  } catch (_) {}
  return names;
}

// 只读检测 Desktop 日志里的封禁/禁用痕迹（绝不输出 Cookie/凭据内容，只统计命中数）
const BAN_TRACE_RE = /organization_disabled|organization has been disabled|account (?:has been )?(?:banned|deactivated|suspended)|banned for|device (?:is )?banned/i;
function detectBanTraces(desktopDir) {
  const logsDir = path.join(desktopDir, "logs");
  const hits = [];
  if (!isRealDir(logsDir)) return hits;
  let names = [];
  try { names = fs.readdirSync(logsDir); } catch (_) { return hits; }
  for (const n of names) {
    const f = path.join(logsDir, n);
    let st;
    try { st = fs.statSync(f); } catch (_) { continue; }
    if (!st.isFile() || st.size > 64 * 1024 * 1024) continue;
    let content = "";
    try { content = fs.readFileSync(f, "utf8"); } catch (_) { continue; }
    const count = (content.match(BAN_TRACE_RE) || []).length;
    if (count) hits.push(`logs/${n}: ${count} 处封禁/禁用记录`);
  }
  return hits;
}

function countSessionAccounts(desktopDir) {
  const seen = new Set();
  for (const sub of ["local-agent-mode-sessions", "claude-code-sessions"]) {
    const root = path.join(desktopDir, sub);
    if (!isRealDir(root)) continue;
    let names = [];
    try { names = fs.readdirSync(root).slice(0, 64); } catch (_) { continue; }
    for (const n of names) {
      if (!n.startsWith(".") && ACCOUNT_DIR_RE.test(n) && isRealDir(path.join(root, n))) seen.add(n.toLowerCase());
    }
  }
  return seen.size;
}

function keychainExists(service, isRealHome) {
  if (!isRealHome || process.platform !== "darwin") return false;
  try {
    // -s 不带 -w：只判断是否存在，绝不读取密码
    execFileSync("/usr/bin/security", ["find-generic-password", "-s", service], { stdio: "ignore", timeout: 1500 });
    return true;
  } catch (_) { return false; }
}

function keychainDelete(service, isRealHome) {
  if (!isRealHome || process.platform !== "darwin") return false;
  try {
    execFileSync("/usr/bin/security", ["delete-generic-password", "-s", service], { stdio: "ignore", timeout: 2500 });
    return true;
  } catch (_) { return false; }
}

function defaultsDelete(isRealHome) {
  if (!isRealHome || process.platform !== "darwin") return false;
  try {
    execFileSync("/usr/bin/defaults", ["delete", DEFAULTS_DOMAIN], { stdio: "ignore", timeout: 2000 });
    return true;
  } catch (_) { return false; }
}

function runningClaude(platform) {
  if (platform === "darwin") return runningClaudeDarwin();
  if (platform === "win32") return runningClaudeWindows();
  return [];
}

function runningClaudeDarwin() {
  let out = "";
  try { out = execFileSync("/bin/ps", ["-axo", "pid=,args="], { encoding: "utf8", timeout: 3000 }); } catch (_) { return []; }
  const hits = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m || Number(m[1]) === process.pid) continue;
    const cmd = m[2];
    if (/\/Claude\.app\/Contents\/MacOS\/Claude(\s|$)/.test(cmd)) hits.push({ pid: Number(m[1]), kind: "Claude Desktop" });
    else if (/(^|\/)claude(\s|$)/.test(cmd.split(" ")[0]) || /@anthropic-ai\/claude-code/.test(cmd) || /\/\.local\/share\/claude\/versions\//.test(cmd)) {
      if (!/claude_env_cleanup/.test(cmd)) hits.push({ pid: Number(m[1]), kind: "Claude Code CLI" });
    }
  }
  return hits;
}

function runningClaudeWindows() {
  let out = "";
  try {
    out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 5000 });
  } catch (_) { return []; }
  const hits = [];
  let nextPid = 1;
  for (const line of out.split("\n")) {
    const cols = line.match(/"([^"]*)"/g);
    if (!cols || cols.length < 2) continue;
    const image = cols[0].slice(1, -1).toLowerCase();
    const pid = Number(cols[1].slice(1, -1)) || nextPid++;
    if (/^claude(\.exe)?$/i.test(image)) hits.push({ pid, kind: "Claude Desktop" });
    else if (/^claude-code(\.exe)?$/i.test(image) || /@anthropic-ai[\\/]claude-code/.test(line)) {
      hits.push({ pid, kind: "Claude Code CLI" });
    }
  }
  return hits;
}

function copySecure(src, dst) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
    for (const ent of fs.readdirSync(src)) copySecure(path.join(src, ent), path.join(dst, ent));
  } else if (st.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o600);
  }
}

function writeJsonAtomic(p, obj) {
  const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, p);
}

// ---------------------------------------------------------------- scan

function scan(P) {
  const desktop = [];
  const cli = [];
  const keychain = [];
  const relay = [];
  const banTrace = [];
  const notes = [];

  if (isRealDir(P.desktopDir)) {
    for (const t of DESKTOP_RESET_TARGETS) {
      if (lexists(path.join(P.desktopDir, t))) desktop.push(DESKTOP_KEY_LABELS[t] || t);
    }
  }
  const sys = listSystemCacheHits(P.home).map((h) => h.rel);
  const sessionAccounts = isRealDir(P.desktopDir) ? countSessionAccounts(P.desktopDir) : 0;
  if (sessionAccounts >= 2) notes.push(`检测到 ${sessionAccounts} 个不同账号的 Desktop 历史会话目录（多号关联高危）`);

  let trackingKeyCount = 0;
  if (lexists(P.claudeJson)) {
    const j = readJsonSafe(P.claudeJson);
    if (j && typeof j === "object" && !Array.isArray(j)) {
      trackingKeyCount = Object.keys(j).filter((k) => !CLAUDE_JSON_PRESERVE_KEYS.has(k)).length;
      if (trackingKeyCount > 0) cli.push(`~/.claude.json 含 ${trackingKeyCount} 个设备/账号跟踪字段（userID 等）`);
    } else if (j === undefined) {
      notes.push("~/.claude.json 无法解析为 JSON，clean 时会拒绝改写");
    }
  }
  for (const t of DOT_CLAUDE_RESET_TARGETS) {
    if (lexists(path.join(P.dotClaude, t))) cli.push(`~/.claude/${t}`);
  }

  if (keychainExists(KEYCHAIN_CLI, P.isRealHome)) keychain.push(`Keychain: ${KEYCHAIN_CLI}`);
  if (keychainExists(KEYCHAIN_DESKTOP, P.isRealHome)) keychain.push(`Keychain: ${KEYCHAIN_DESKTOP}`);
  if (!P.isRealHome || P.platform !== "darwin") notes.push("非真实 HOME 或非 macOS：已跳过 Keychain 与 defaults 检查");

  banTrace.push(...detectBanTraces(P.desktopDir));

  const relayRe = /^\s*(export\s+)?(ANTHROPIC_(BASE_URL|AUTH_TOKEN|API_KEY)|HTTPS?_PROXY|ALL_PROXY|https?_proxy|all_proxy)\s*=/;
  const rcHits = [];
  for (const n of SHELL_RC_FILES) {
    const f = path.join(P.home, n);
    if (!lexists(f)) continue;
    try {
      const lines = fs.readFileSync(f, "utf8").split("\n");
      const vars = [];
      lines.forEach((l, i) => {
        const m = l.match(relayRe);
        if (m && !l.trim().startsWith("#")) vars.push(`${m[2]} (第 ${i + 1} 行)`);
      });
      if (vars.length) rcHits.push({ file: `~/${n}`, vars });
    } catch (_) {}
  }
  for (const h of rcHits) relay.push(`${h.file}: ${h.vars.join(", ")}（仅报告，需手动处理）`);
  for (const s of settingsCandidateFiles(P.dotClaude)) {
    const j = readJsonSafe(path.join(P.dotClaude, s));
    if (j && j.env && typeof j.env === "object") {
      const keys = RELAY_ENV_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(j.env, k));
      if (keys.length) {
        const tag = /\.bak$/i.test(s) || /settings\.json\.\d+/.test(s) ? "（备份文件凭据残留）" : "";
        relay.push(`~/.claude/${s} env: ${keys.join(", ")}${tag}`);
      }
    }
  }

  const envProxy = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", ...RELAY_ENV_KEYS]
    .filter((k) => process.env[k]);
  if (envProxy.length) relay.push(`当前进程环境变量: ${envProxy.join(", ")}（值已隐藏）`);

  const total = desktop.length + sys.length + cli.length + keychain.length + relay.length + banTrace.length;
  return {
    home: P.home,
    clean: total === 0,
    count: total,
    categories: { desktop, systemCache: sys, cli, keychain, relay, banTrace },
    sessionAccounts,
    notes,
    running: P.isRealHome ? runningClaude(P.platform) : [],
  };
}

// ---------------------------------------------------------------- clean

function clean(P, flags) {
  if (!flags.has("--yes")) {
    throw new Error("clean 会删除本地登录态与设备标识，必须显式加 --yes 二次确认");
  }
  const live = P.isRealHome ? runningClaude(P.platform) : [];
  if (live.length) {
    throw new Error(`Claude 仍在运行（${live.map((x) => `${x.kind} PID ${x.pid}`).join("，")}），请先完全退出再清理，否则退出时会回写旧 Cookie/设备 ID`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(P.backupRoot, stamp);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(P.backupRoot, 0o700);

  const result = {
    backupDir,
    desktop: [],
    systemCache: [],
    defaultsDeleted: false,
    claudeJsonRemovedKeys: [],
    dotClaude: [],
    relaySettings: [],
    keychain: [],
    preservedDesktopMcpConfig: null,
  };

  // 1. Claude Desktop 存储 / 设备 ID（保留 MCP 配置）
  if (isRealDir(P.desktopDir)) {
    const mcpPath = path.join(P.desktopDir, DESKTOP_PRESERVE);
    const mcpRaw = lexists(mcpPath) ? fs.readFileSync(mcpPath) : null;
    for (const t of DESKTOP_RESET_TARGETS) {
      const abs = path.join(P.desktopDir, t);
      if (!lexists(abs)) continue;
      copySecure(abs, path.join(backupDir, "claude-desktop", t));
      fs.rmSync(abs, { recursive: true, force: true });
      result.desktop.push(t);
    }
    if (mcpRaw && !lexists(mcpPath)) fs.writeFileSync(mcpPath, mcpRaw, { mode: 0o600 });
    result.preservedDesktopMcpConfig = mcpRaw ? lexists(mcpPath) : null;
  }

  // 2. macOS 系统级日志 / 缓存 / HTTPStorages / plist
  for (const h of listSystemCacheHits(P.home)) {
    copySecure(h.abs, path.join(backupDir, "macos-system", h.rel));
    fs.rmSync(h.abs, { recursive: true, force: true });
    result.systemCache.push(h.rel);
  }
  result.defaultsDeleted = defaultsDelete(P.isRealHome);

  // 3. ~/.claude.json 白名单保留（mcpServers 与 UI 偏好），其余身份/遥测字段全部移除
  if (lexists(P.claudeJson)) {
    const raw = fs.readFileSync(P.claudeJson, "utf8");
    let j;
    try { j = JSON.parse(raw); } catch (_) {
      throw new Error("~/.claude.json 不是合法 JSON，拒绝改写（已创建的备份目录：" + backupDir + "）");
    }
    if (j && typeof j === "object" && !Array.isArray(j)) {
      const removed = Object.keys(j).filter((k) => !CLAUDE_JSON_PRESERVE_KEYS.has(k));
      if (removed.length) {
        copySecure(P.claudeJson, path.join(backupDir, "claude.json.bak"));
        for (const k of removed) delete j[k];
        writeJsonAtomic(P.claudeJson, j);
        result.claudeJsonRemovedKeys = removed;
      }
    }
  }

  // 4. ~/.claude 下的凭据 / 会话 / 遥测（保留 settings、keybindings、skills、plugins、agents、commands、CLAUDE.md）
  if (isRealDir(P.dotClaude)) {
    for (const t of DOT_CLAUDE_RESET_TARGETS) {
      const abs = path.join(P.dotClaude, t);
      if (!lexists(abs)) continue;
      copySecure(abs, path.join(backupDir, "dot-claude", t));
      fs.rmSync(abs, { recursive: true, force: true });
      result.dotClaude.push(t);
    }
    if (!flags.has("--keep-relay")) {
      for (const s of settingsCandidateFiles(P.dotClaude)) {
        const sp = path.join(P.dotClaude, s);
        const j = readJsonSafe(sp);
        if (!j || !j.env || typeof j.env !== "object") continue;
        const removed = RELAY_ENV_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(j.env, k));
        if (!removed.length) continue;
        copySecure(sp, path.join(backupDir, "dot-claude", s));
        for (const k of removed) delete j.env[k];
        writeJsonAtomic(sp, j);
        result.relaySettings.push({ file: s, removedKeys: removed });
      }
    }
  }

  // 5. Keychain（仅显式要求时）
  if (flags.has("--keychain") && keychainDelete(KEYCHAIN_CLI, P.isRealHome)) result.keychain.push(KEYCHAIN_CLI);
  if (flags.has("--keychain-desktop") && keychainDelete(KEYCHAIN_DESKTOP, P.isRealHome)) result.keychain.push(KEYCHAIN_DESKTOP);

  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify({ ...result, home: P.home, createdAt: stamp }, null, 2), { mode: 0o600 });
  return result;
}

// ---------------------------------------------------------------- restore

function restore(P, from, flags) {
  if (!from) throw new Error("restore 需要 --from <备份目录>（位于 ~/.claude-env-cleanup-backups/ 下）");
  const src = path.resolve(from);
  if (!isRealDir(src)) throw new Error(`备份目录不存在: ${src}`);
  const force = flags.has("--force");
  const restored = [];
  const skipped = [];

  const put = (backupPath, targetPath) => {
    if (!lexists(backupPath)) return;
    if (lexists(targetPath) && !force) { skipped.push(targetPath); return; }
    if (lexists(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
    copySecure(backupPath, targetPath);
    restored.push(targetPath);
  };
  const putDir = (backupDir, targetBase) => {
    if (!isRealDir(backupDir)) return;
    for (const ent of fs.readdirSync(backupDir)) put(path.join(backupDir, ent), path.join(targetBase, ent));
  };

  putDir(path.join(src, "claude-desktop"), P.desktopDir);
  putDir(path.join(src, "dot-claude"), P.dotClaude);
  put(path.join(src, "claude.json.bak"), P.claudeJson);
  const sysRoot = path.join(src, "macos-system");
  if (isRealDir(sysRoot)) {
    const walk = (rel) => {
      const abs = path.join(sysRoot, rel);
      for (const ent of fs.readdirSync(abs)) {
        const childRel = path.join(rel, ent);
        const depth = childRel.split(path.sep).length;
        // 规格中的条目在 relDir 下第一层：Library/Logs/Claude、.cache/claude 等
        const spec = SYSTEM_CACHE_SPECS.find((s) => path.dirname(childRel) === s.relDir);
        if (spec) put(path.join(sysRoot, childRel), path.join(P.home, childRel));
        else if (depth < 4 && isRealDir(path.join(sysRoot, childRel))) walk(childRel);
      }
    };
    walk("");
  }
  return { from: src, restored, skipped, note: skipped.length ? "目标已存在的条目已跳过，确认要覆盖请加 --force" : "" };
}

// ---------------------------------------------------------------- output

function printScan(r) {
  const L = [];
  L.push(`Claude 本地环境扫描  HOME=${r.home}`);
  L.push(r.clean ? "结果：未发现残留 ✓" : `结果：发现 ${r.count} 项残留`);
  const sec = (title, arr) => { if (arr.length) { L.push(`\n[${title}]`); for (const x of arr) L.push(`  - ${x}`); } };
  sec("Claude Desktop 存储与设备 ID", r.categories.desktop);
  sec("系统日志 / 缓存", r.categories.systemCache);
  sec("Claude Code CLI 身份 / 会话", r.categories.cli);
  sec("Keychain（仅检测存在，未读取）", r.categories.keychain);
  sec("中转 / 代理配置", r.categories.relay);
  sec("封禁痕迹（只读检测，清理 logs 即移除）", r.categories.banTrace);
  if (r.notes.length) sec("提示", r.notes);
  if (r.running.length) sec("正在运行（清理前需退出）", r.running.map((x) => `${x.kind} PID ${x.pid}`));
  console.log(L.join("\n"));
}

function printClean(r) {
  const L = [];
  L.push("清理完成");
  L.push(`备份目录: ${r.backupDir}`);
  L.push(`Claude Desktop: 清理 ${r.desktop.length} 项${r.preservedDesktopMcpConfig ? "（MCP 配置已保留）" : ""}`);
  L.push(`系统缓存/日志: 清理 ${r.systemCache.length} 项；defaults 偏好: ${r.defaultsDeleted ? "已删除" : "未删除/不存在"}`);
  L.push(`~/.claude.json: 移除 ${r.claudeJsonRemovedKeys.length} 个跟踪字段（mcpServers 与界面偏好已保留）`);
  L.push(`~/.claude: 清理 ${r.dotClaude.length} 项`);
  if (r.relaySettings.length) L.push(`settings 中转变量: ${r.relaySettings.map((x) => `${x.file}(${x.removedKeys.join(",")})`).join("；")}`);
  L.push(`Keychain: ${r.keychain.length ? r.keychain.join("，") + " 已删除" : "未改动"}`);
  L.push(`\n如需还原: node ${path.basename(__filename)} restore --from "${r.backupDir}"`);
  console.log(L.join("\n"));
}

function main() {
  const args = parseArgs(process.argv);
  const P = resolvePaths(args.home);
  const asJson = args.flags.has("--json");
  try {
    let out;
    if (args.cmd === "scan") {
      out = scan(P);
      asJson ? console.log(JSON.stringify(out, null, 2)) : printScan(out);
    } else if (args.cmd === "clean") {
      out = clean(P, args.flags);
      asJson ? console.log(JSON.stringify(out, null, 2)) : printClean(out);
    } else if (args.cmd === "restore") {
      out = restore(P, args.from, args.flags);
      console.log(asJson ? JSON.stringify(out, null, 2) : `已还原 ${out.restored.length} 项，跳过 ${out.skipped.length} 项${out.note ? "。" + out.note : ""}`);
    } else {
      console.error("未知命令。可用: scan | clean --yes | restore --from <dir>");
      process.exit(2);
    }
  } catch (e) {
    if (asJson) console.log(JSON.stringify({ ok: false, error: e.message }));
    else console.error(`错误: ${e.message}`);
    process.exit(1);
  }
}

main();
