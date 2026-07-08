# Root Config

Single canonical source for AI tool configurations at the parent workspace root (`~/dev/<your-org>/`).

`npm install` in `workspace/` mirrors this directory to the parent root:

- **Files** (AGENTS.md) are **symlinked**
- **Symlinks** (CLAUDE.md → AGENTS.md) are **recreated** at parent root
- **Directories** (.cursor/, .claude/, .agents/) are **created** at root with contents **symlinked** back

`README.md` and `skills-lock.json` are not mirrored.

## Current Contents

```
root-config/
├── AGENTS.md           # Standing instructions for all AI tools
├── CLAUDE.md           # Symlink to AGENTS.md (Claude Code entry point)
├── .mcp.json           # Symlink to .agents/mcp.json (Claude Code MCP entry point)
├── .agents/
│   ├── mcp.json        # Canonical MCP server definitions
│   └── skills/         # Shared AI agent skills (workspace-wide)
├── .cursor/
│   └── mcp.json        # Symlink to ../.agents/mcp.json (Cursor MCP)
├── .codex/
│   └── config.toml     # Codex MCP twin (hand-maintained)
└── .vscode/
    └── mcp.json        # VS Code MCP twin (hand-maintained)
```

## Supported Conventions

Add files and directories as needed — the mirror picks them up automatically.

### Files (symlinked to root)

| File | Purpose |
|------|---------|
| `AGENTS.md` | Standing instructions for AI tools |

### Symlinks (recreated at root)

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Symlink to `AGENTS.md` — Claude Code entry point |

### `.agents/`

| Path | Purpose |
|------|---------|
| `.agents/mcp.json` | Canonical MCP server definitions (shared across tools) |
| `.agents/skills/<name>/SKILL.md` | Shared skills, available to all repos via symlinks |

### MCP (Model Context Protocol)

| Path | Purpose |
|------|---------|
| `.agents/mcp.json` | Canonical MCP config (`mcpServers` schema) |
| `.mcp.json` | Symlink to `.agents/mcp.json` — Claude Code |
| `.cursor/mcp.json` | Symlink to `../.agents/mcp.json` — Cursor |
| `.codex/config.toml` | Codex MCP twin (TOML, hand-maintained) |
| `.vscode/mcp.json` | VS Code MCP twin (`servers` schema, hand-maintained) |

When adding or changing a server, edit `.agents/mcp.json`, then update `.codex/config.toml` and `.vscode/mcp.json`. Claude Code and Cursor pick up changes via symlinks automatically.

**Mirror all, no opt-out.** Every developer gets all tool configs (Cursor, Claude Code, Codex, VS Code). `npm install` and git hooks recreate them at the parent root — deleting a parent-root `.cursor/` or `.codex/` folder does not opt out; setup will restore it. Unused symlinks are harmless. Per-project overrides still win via nearest-wins (`<project>/.cursor/mcp.json` etc.).

**Existing workspaces:** `npm run upgrade` scaffolds missing MCP files and merges template servers (e.g. context7) with any servers you already have — bundled servers are refreshed from the template; your own servers (not shipped by aiworkspace) are preserved. Servers that exist only at the parent workspace root are migrated into canonical on upgrade if they are not already there.

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

- Parent-root files are symlinked to `root-config/` — edits persist in the canonical git-tracked source. On platforms where symlinks are unavailable (e.g. Windows without developer mode), `safeSymlink` falls back to copying and edits at the parent root will **not** persist automatically.
- **MCP configs** are tracked in `root-config/` with env-var placeholders when auth is needed; actual tokens stay local (not in git). All tool configs are mirrored for every developer — there is no per-tool opt-out.
