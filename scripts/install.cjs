#!/usr/bin/env node
/*
 * claude-env-cleanup installer — 把本 skill 安装到主流 Agent 的 skills 目录。
 *
 * 零依赖，Node 18+，支持 macOS / Linux / Windows。
 * 默认用符号链接（git pull 后自动生效）；--copy 复制一份；Windows 无权限建链接时自动回退复制。
 *
 * 用法：
 *   node scripts/install.cjs --list
 *   node scripts/install.cjs --agent claude-code
 *   node scripts/install.cjs --agent codex,cursor,gemini-cli
 *   node scripts/install.cjs --all
 *   node scripts/install.cjs --agent claude-code --project /path/to/repo
 *   node scripts/install.cjs --agent claude-code --copy
 *   node scripts/install.cjs --agent claude-code --dry-run
 *   测试/隔离：--home <dir> 指定用户主目录
 *
 * 安全约束：
 *   - 目标已存在且不是本 skill 的链接时，默认拒绝，必须 --force（先备份再装）。
 *   - 不修改任何 Agent 配置，只创建 skills 目录下的入口。
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const SKILL_NAME = "claude-env-cleanup";
const SOURCE_DIR = path.resolve(__dirname, "..");

// 路径依据 Agent Skills 规范与社区维护的 agent→path 表（2026-11）：
// https://agentskills.io/specification
// https://github.com/vercel-labs/skills/blob/main/docs/agents.md
const AGENTS = [
  { id: "claude-code", name: "Claude Code", project: [".claude", "skills"], global: [".claude", "skills"] },
  { id: "codex", name: "Codex CLI", project: [".agents", "skills"], global: [".agents", "skills"] },
  { id: "cursor", name: "Cursor", project: [".agents", "skills"], global: [".cursor", "skills"] },
  { id: "gemini-cli", name: "Gemini CLI", project: [".agents", "skills"], global: [".gemini", "skills"] },
  { id: "github-copilot", name: "GitHub Copilot", project: [".agents", "skills"], global: [".copilot", "skills"] },
  { id: "opencode", name: "OpenCode", project: [".agents", "skills"], global: [".config", "opencode", "skills"] },
  { id: "antigravity", name: "Antigravity", project: [".agents", "skills"], global: [".gemini", "config", "skills"] },
  { id: "windsurf", name: "Windsurf", project: [".windsurf", "skills"], global: [".codeium", "windsurf", "skills"] },
  { id: "cline", name: "Cline", project: [".agents", "skills"], global: [".agents", "skills"] },
  { id: "continue", name: "Continue", project: [".continue", "skills"], global: [".continue", "skills"] },
  { id: "roo", name: "Roo Code", project: [".roo", "skills"], global: [".roo", "skills"] },
  { id: "qwen-code", name: "Qwen Code", project: [".qwen", "skills"], global: [".qwen", "skills"] },
  { id: "amp", name: "Amp", project: [".agents", "skills"], global: [".config", "agents", "skills"] },
  { id: "workbuddy", name: "WorkBuddy", project: [".workbuddy", "skills"], global: [".workbuddy", "skills"] },
  { id: "agents", name: "通用 .agents（DSH / 多 Agent 共享）", project: [".agents", "skills"], global: [".agents", "skills"] },
  { id: "dsh", name: "DeepSeek Harness", project: [".agents", "skills"], global: [".agents", "skills"] },
];

function parseArgs(argv) {
  const args = { agents: [], all: false, project: null, home: null, copy: false, force: false, dryRun: false, list: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--list") args.list = true;
    else if (a === "--all") args.all = true;
    else if (a === "--copy") args.copy = true;
    else if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--agent") args.agents.push(...String(rest[++i] || "").split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--project") args.project = rest[++i];
    else if (a === "--home") args.home = rest[++i];
    else if (a === "-h" || a === "--help") args.list = true;
    else throw new Error(`未知参数: ${a}`);
  }
  return args;
}

function targetFor(spec, args, home) {
  const rel = args.project ? spec.project : spec.global;
  const base = args.project ? path.resolve(args.project) : home;
  return path.join(base, ...rel, SKILL_NAME);
}

function isOurs(target) {
  try {
    if (!fs.lstatSync(target).isSymbolicLink()) return false;
    return fs.realpathSync(target) === fs.realpathSync(SOURCE_DIR);
  } catch (_) { return false; }
}

function backupExisting(target) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // 放到 skills 目录之外，避免 Agent 把备份当成第二个同名 skill
  const dir = path.join(path.dirname(path.dirname(target)), "claude-env-cleanup-backups");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const bak = path.join(dir, `${SKILL_NAME}.bak-${stamp}`);
  fs.renameSync(target, bak);
  return bak;
}

function copySkill(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  fs.cpSync(SOURCE_DIR, target, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === ".git" || base === "node_modules") return false;
      return true;
    },
  });
}

function installOne(spec, args, home) {
  const target = targetFor(spec, args, home);
  const exists = fs.lstatSync(target, { throwIfNoEntry: false });
  if (exists && isOurs(target) && !args.force) return { spec, target, action: "already" };
  if (exists && !args.force) {
    throw new Error(`${target} 已存在且不是本 skill 的链接；确认要替换请加 --force（会先备份）`);
  }

  let backup = null;
  if (args.dryRun) {
    return { spec, target, action: args.copy ? "dry-copy" : "dry-link" };
  }
  if (exists) backup = backupExisting(target);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });

  let method = "symlink";
  if (args.copy) {
    copySkill(target);
    method = "copy";
  } else {
    try {
      fs.symlinkSync(SOURCE_DIR, target, process.platform === "win32" ? "junction" : "dir");
    } catch (_) {
      copySkill(target);
      method = "copy-fallback";
    }
  }
  return { spec, target, action: "installed", method, backup };
}

function printList(home) {
  const rows = AGENTS.map((a) => ({
    agent: a.id,
    name: a.name,
    global: path.join(home, ...a.global, SKILL_NAME),
    project: path.join("<project>", ...a.project, SKILL_NAME),
  }));
  const w = Math.max(...rows.map((r) => r.agent.length), 5);
  const gw = Math.max(...rows.map((r) => r.global.length), 10);
  console.log("Agent".padEnd(w + 2) + "全局安装路径".padEnd(gw + 2) + "项目安装路径");
  for (const r of rows) console.log(r.agent.padEnd(w + 2) + r.global.padEnd(gw + 2) + r.project);
  console.log("\n提示：Codex / Cursor / Gemini CLI / Copilot / OpenCode / Amp 等项目级路径都支持 .agents/skills。");
}

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (e) { console.error(`错误: ${e.message}`); process.exit(2); }
  const home = path.resolve(args.home || os.homedir());
  if (args.list || (!args.agents.length && !args.all)) {
    printList(home);
    if (!args.list) console.log("\n示例: node scripts/install.cjs --agent claude-code --copy");
    return;
  }
  const ids = args.all ? AGENTS.map((a) => a.id) : [...new Set(args.agents)];
  const unknown = ids.filter((id) => !AGENTS.some((a) => a.id === id));
  if (unknown.length) {
    console.error(`未知 agent: ${unknown.join(", ")}`);
    console.error(`可用: ${AGENTS.map((a) => a.id).join(", ")}`);
    process.exit(2);
  }
  const seen = new Set();
  for (const id of ids) {
    const spec = AGENTS.find((a) => a.id === id);
    const target = targetFor(spec, args, home);
    if (seen.has(target)) continue;
    seen.add(target);
    try {
      const r = installOne(spec, args, home);
      if (r.action === "already") console.log(`已存在  ${r.spec.id} → ${r.target}`);
      else if (r.action === "dry-link" || r.action === "dry-copy") console.log(`[dry-run] ${r.spec.id} → ${r.target}（${r.action === "dry-copy" ? "复制" : "符号链接"}）`);
      else {
        console.log(`已安装  ${r.spec.id} → ${r.target}（${r.method === "symlink" ? "symlink" : "复制"}）`);
        if (r.backup) console.log(`  原目录已备份到 ${r.backup}`);
        if (r.method === "copy" || r.method === "copy-fallback") console.log("  复制安装：git pull 后需重新运行本脚本更新");
      }
    } catch (e) {
      console.error(`失败    ${spec.id}: ${e.message}`);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) main();

module.exports = { AGENTS, targetFor, isOurs };
