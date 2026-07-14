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
├── .env.example        # token template (mirrors to parent)
├── CLAUDE.md           # Symlink to AGENTS.md (Claude Code entry point)
├── .mcp.json           # Symlink to .agents/mcp.json (Claude Code MCP entry point)
├── .agents/
│   ├── mcp.json        # Canonical MCP server definitions
│   └── skills/         # Shared AI agent skills (workspace-wide)
├── .cursor/
│   ├── mcp.json        # Symlink to ../.agents/mcp.json (Cursor MCP)
│   ├── settings.json   # Team Cursor settings (mirrored)
│   └── rules/          # Team Cursor rules (mirrored)
├── .claude/
│   ├── settings.json   # Team Claude Code settings (mirrored)
│   └── settings.local.json.example  # Optional personal MCP enable list (copy once; not mirrored live)
├── .codex/
│   ├── config.toml     # Codex config (preamble team-editable; MCP blocks sync-derived)
│   └── rules/          # Team Codex rules (mirrored)
└── .vscode/
    ├── mcp.json        # VS Code MCP twin (sync-derived from canonical)
    ├── settings.json   # Team workspace editor defaults (mirrored)
    └── extensions.json # Recommended extensions (mirrored)
```

## Team vs personal by editor

Everyone shares **MCP definitions** (`.agents/mcp.json`) and **agent instructions** (`AGENTS.md`). Tool-specific settings split differently:

| Concern | Claude | Cursor | VS Code | Codex |
|---------|--------|--------|---------|-------|
| MCP definitions | Symlinked `.mcp.json` | Symlinked `.cursor/mcp.json` | Generated `.vscode/mcp.json` | Generated `[mcp_servers.*]` in `config.toml` |
| Team tool settings | `settings.json` | `.cursor/settings.json`, `.cursor/rules/` | `.vscode/settings.json`, `extensions.json` | Preamble in `config.toml`, `.codex/rules/` |
| Personal overrides | `settings.local.json` (copy from example) | Cursor User settings + Settings → MCP | User `settings.json` + MCP UI | `~/.codex/config.toml` + `codex mcp login` |
| MCP on/off per user | `enabledMcpjsonServers` in local file | Settings → MCP | MCP extension UI | OAuth login state per machine |
| Secrets | `.env.local` at parent root | Same (+ Cursor Bearer env-load step) | `envFile` on MCP twin | `bearer_token_env_var` / user config |

**Sync never overwrites:** `.claude/settings.local.json`, editor user settings, or `~/.codex/config.toml`.

**Do not hand-edit** Codex `[mcp_servers.*]` blocks or VS Code `mcp.json` — edit `.agents/mcp.json` and run `npm run sync`.

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
| `.agents/mcp-disabled.json` | Bundled servers this workspace opts out of (optional) |
| `.mcp.json` | Symlink to `.agents/mcp.json` — Claude Code |
| `.cursor/mcp.json` | Symlink to `../.agents/mcp.json` — Cursor |
| `.codex/config.toml` | Codex MCP twin (TOML, regenerated on `npm run sync`) |
| `.vscode/mcp.json` | VS Code MCP twin (`servers` schema, regenerated on `npm run sync`) |

Edit `.agents/mcp.json` to add or change servers. `npm run sync` refreshes the Codex and VS Code twins from canonical automatically. Claude Code and Cursor pick up changes via symlinks (or a local copy when symlinks are unavailable — copies are not committed).

**Dropping a bundled server:** deleting it from `.agents/mcp.json` is not enough — sync restores bundled servers from the template, and cannot tell a deliberate removal from a workspace that simply hasn't received it yet. List it in `.agents/mcp-disabled.json` instead:

```json
{ "disabled": ["context7"] }
```

Disabled servers are left out of canonical and both twins. (The list lives in its own file because `.agents/mcp.json` *is* `.mcp.json` and `.cursor/mcp.json` via symlink — editors parse it directly, and anything left under `mcpServers` would still be launched.)

Only `[mcp_servers.*]` tables in `.codex/config.toml` are regenerated; other Codex settings you add to that file are preserved.

**Secrets:** copy `.env.example` to `.env.local` at the parent workspace root, fill tokens, restart the editor. Stdio servers load `.env.local` automatically; **Cursor** users with HTTP Bearer MCP servers also need a one-time env-loading step — see `<workspace-repo>/setup.md` §4.1 (`<workspace-repo>` is this repo's directory name, e.g. `workspace`).

**Mirror all, no opt-out.** Every developer gets all tool configs (Cursor, Claude Code, Codex, VS Code). `npm install` and git hooks recreate them at the parent root — deleting a parent-root `.cursor/` or `.codex/` folder does not opt out; setup will restore it. Unused symlinks are harmless. Per-project overrides still win via nearest-wins (`<project>/.cursor/mcp.json` etc.).

**Existing workspaces:** `npm run sync` scaffolds missing MCP files and merges template servers (e.g. context7) with any servers you already have — bundled servers are refreshed from the template; your own servers (not shipped by aiworkspace) are preserved. Servers that exist only at the parent workspace root are migrated into canonical on sync if they are not already there.

### `.cursor/` (Cursor IDE)

| Path | Purpose |
|------|---------|
| `.cursor/mcp.json` | Symlink to `../.agents/mcp.json` — MCP definitions (team) |
| `.cursor/settings.json` | **Team** Cursor settings (plugins, workspace defaults) — mirrored to parent root |
| `.cursor/rules/<name>.mdc` | **Team** persistent rules across all repos (mirrored) |
| `.cursor/plans/<name>.md` | Saved workspace-level plans |
| `.cursor/agents/<name>.md` | Custom Cursor agents |

**Team vs personal:** `settings.json` is shared and symlinked on `npm run sync`. Teams add plugin defaults and other workspace-scoped Cursor settings there (e.g. `"plugins": { "cursor-team-kit": { "enabled": true } }`). Personal editor preferences and MCP enable/disable stay in Cursor User settings (`~/Library/Application Support/Cursor/User/settings.json` on macOS) and Settings → MCP — not mirrored.

### `.claude/` (Claude Code)

| Path | Purpose |
|------|---------|
| `.claude/settings.json` | **Team** Claude Code settings (permissions, hooks) — mirrored to parent root |
| `.claude/settings.local.json.example` | Starter for **personal** MCP enable list — copy once; live `settings.local.json` is never mirrored |
| `.claude/rules/<name>.md` | Persistent rules |
| `.claude/commands/<name>.md` | Custom slash commands |
| `.claude/agents/<name>.md` | Custom agents |

**Team vs personal:** `settings.json` is shared and symlinked on `npm run sync`. `settings.local.json` holds per-developer overrides (`enabledMcpjsonServers`, `skillOverrides`) and must stay local — copy from the example after install:

```bash
cp <workspace-repo>/root-config/.claude/settings.local.json.example .claude/settings.local.json
```

Remove MCP names you do not use. Sync never overwrites an existing `settings.local.json`.

### `.vscode/` (VS Code + Copilot)

| Path | Purpose |
|------|---------|
| `.vscode/mcp.json` | MCP twin (`servers` schema) — regenerated from canonical on sync |
| `.vscode/settings.json` | **Team** workspace editor defaults when opening parent root |
| `.vscode/extensions.json` | Recommended extensions for the monorepo |

**Personal:** User settings and MCP UI toggles stay in VS Code User scope — not mirrored.

### `.codex/` (OpenAI Codex)

| Path | Purpose |
|------|---------|
| `.codex/config.toml` | Team config: editable **preamble** before `[mcp_servers.*]`; MCP blocks regenerated on sync |
| `.codex/rules/<name>.md` | **Team** Codex rules (mirrored) |
| `.codex/agents/<name>.md` | Custom agents |

**Personal:** model, provider, and auth in `~/.codex/config.toml`. Run `codex mcp login <name>` once per OAuth HTTP server.

## Adding a New Config

```bash
mkdir -p root-config/.cursor/rules
echo "# My Rule" > root-config/.cursor/rules/code-style.md
npm run skills:setup
```

## Important

- Parent-root files are symlinked to `root-config/` — edits persist in the canonical git-tracked source. On platforms where symlinks are unavailable (e.g. Windows without developer mode), `safeSymlink` falls back to copying and edits at the parent root will **not** persist automatically.
- **MCP configs** are tracked in `root-config/` with env-var placeholders when auth is needed; actual tokens stay local (not in git). All tool configs are mirrored for every developer — there is no per-tool opt-out.
