# Root Config

Single canonical source for AI tool configurations at the parent workspace root (`~/dev/<your-org>/`).

`npm install` in `workspace/` mirrors this directory to the parent root:

- **Files** (AGENTS.md, CLAUDE.md) are **copied** (protects canonical from tool writes)
- **Directories** (.cursor/, .claude/, .agents/) are **created** at root with contents **symlinked** back

`README.md` and `skills-lock.json` are not mirrored.

## Current Contents

```
root-config/
├── AGENTS.md           # Standing instructions for all AI tools
└── .agents/
    └── skills/         # Shared AI agent skills (workspace-wide)
```

## Supported Conventions

Add files and directories as needed — the mirror picks them up automatically.

### Files (copied to root)

| File | Purpose |
|------|---------|
| `AGENTS.md` | Standing instructions for AI tools |
| `CLAUDE.md` | Instructions for Claude Code specifically |

### `.agents/skills/`

| Path | Purpose |
|------|---------|
| `.agents/skills/<name>/SKILL.md` | Shared skills, available to all repos via symlinks |

### `.cursor/` (Cursor IDE)

| Path | Purpose |
|------|---------|
| `.cursor/rules/<name>.md` | Persistent rules across all repos |
| `.cursor/plans/<name>.md` | Saved workspace-level plans |
| `.cursor/agents/<name>.md` | Custom Cursor agents |

### `.claude/` (Claude Code)

| Path | Purpose |
|------|---------|
| `.claude/settings.json` | Claude Code settings |
| `.claude/rules/<name>.md` | Persistent rules |
| `.claude/commands/<name>.md` | Custom slash commands |
| `.claude/agents/<name>.md` | Custom agents |

### `.codex/` (OpenAI Codex)

| Path | Purpose |
|------|---------|
| `.codex/config.toml` | Codex configuration |
| `.codex/agents/<name>.md` | Custom agents |
| `.codex/rules/<name>.md` | Persistent rules |

## Adding a New Config

```bash
mkdir -p root-config/.cursor/rules
echo "# My Rule" > root-config/.cursor/rules/code-style.md
npm run skills:setup
```

## Important

- **Never edit files at the parent root** — they get overwritten on sync. Edit here.
- **MCP configs** (`.mcp.json`) contain tokens — not tracked here. Each developer sets them up individually.
