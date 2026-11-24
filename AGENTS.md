# claude-neverbanned-skills

An **Agent Skill** (see [SKILL.md](SKILL.md)) that scans and cleans Claude Desktop / Claude Code local residue on macOS and Windows. Zero dependencies, Node.js 18+.

## If you are asked to clean a user's Claude environment

1. Read [SKILL.md](SKILL.md) first — it is the contract, not optional background.
2. Start with `node scripts/claude_neverbanned_skills.cjs scan` (read-only, no files written).
3. Explain the findings in the user's language, state what cleanup will remove, get **explicit consent**, then ask how to handle the backup (USB / none). Only then run `clean --yes`.
4. Never touch: `/Applications/Claude.app`, `claude_desktop_config.json`, `~/.claude/{skills,plugins,agents,commands,projects}`, `CLAUDE.md`, browser profiles, shell rc files.
5. Do not claim this can unban an account or bypass a platform policy — it cannot. See the "边界" section of SKILL.md.

## Working on this repo

- Tests: `bash scripts/selftest.sh` (uses a throwaway HOME; macOS for the full suite).
- Install into other agents: `node scripts/install.cjs --list`.
- Keep the cleanup path offline and telemetry-free. `netcheck` is the only command that makes network requests, it is opt-in and read-only, and it is documented as such.
- Protected files and the confirm/backup flow are safety invariants; don't weaken them for convenience.
