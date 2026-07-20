# Workspace

This is the workspace root -- the parent directory containing all project repos. Open this directory in your editor.

## Projects

<!-- Add your projects here as you clone them alongside workspace/ -->

| Project | Purpose |
|---------|---------|
| `workspace/` | AI agent skills, configs, and automation |

## Resolution Order

Everything follows **nearest-wins**: the closer a file is to the code you're changing, the higher its priority.

| What | Workspace-wide (shared) | Per-project (override) |
|------|------------------------|----------------------|
| Instructions | This file (`AGENTS.md` at root) | `<project>/AGENTS.md` |
| Skills | `.agents/skills/` | `<project>/.agents/skills/` |
| Rules | `.cursor/rules/` | `<project>/.cursor/rules/` |
| Docs | `docs/` repo (sibling) | `<project>/docs/` |

When guidance conflicts, the closest file to the code wins.

## Finding Context

Before working in a project, check for context nearest to the code first:

1. **Project-level**: `<project>/AGENTS.md`, README, docs, and any project-specific skills or config
2. **Workspace-level**: this file and shared skills/rules at the workspace root

## Conventions

<!-- Replace these examples with your team's conventions -->

- **Branches**: `feature/description`, `bug/description`, `hotfix/description`
- **Commits**: lowercase imperative (`add feature`, `fix bug`, `update config`)
- **PRs**: target default branch unless noted

## Code Quality

- Read existing code before editing. Match the style and patterns already in use.
- Use the nearest config file (linter, formatter, tsconfig) to the code you are changing.
- Run existing tests after changes. Don't skip or weaken tests to make code pass.
- Handle errors explicitly. Don't swallow exceptions or ignore return values.
<!-- Add your team's baseline standards here (e.g., test coverage, logging, accessibility) -->

## MCP servers

MCP servers give agents shared tools. The workspace ships with:

- `context7` — up-to-date documentation for libraries, frameworks, and tools (HTTP OAuth).

These are defined once and shared across tools, the same way `AGENTS.md` and skills are. The canonical config is `.agents/mcp.json`, written with bare `${VAR}` placeholders — the syntax Claude Code resolves natively. Claude Code symlinks straight to it. Cursor requires `${env:VAR}` instead (its own MCP client's requirement, incompatible with Claude Code's), and Codex (TOML) and VS Code (a different JSON schema) can't share the file at all — so Cursor, Codex, and VS Code all get derived twins regenerated from canonical on `npm run sync`.

```
.agents/mcp.json            canonical config (JSON, bare ${VAR})
.mcp.json        -> .agents/mcp.json      Claude Code
.cursor/mcp.json             Cursor (JSON twin, sync-derived, ${env:VAR})
.codex/config.toml           Codex (TOML twin, sync-derived)
.vscode/mcp.json             VS Code and Copilot (JSON twin, sync-derived)
```

To add or change a server, edit `.agents/mcp.json` using bare `${VAR}` for any secret placeholder. `npm run sync` refreshes the Cursor, Codex, and VS Code twins from canonical automatically.

All tool configs are mirrored for every developer — Cursor, Claude Code, Codex, and VS Code. There is no opt-out; unused configs are inert. To override workspace-wide MCP for one repo, use `<project>/.cursor/mcp.json` (nearest-wins).

`npm run sync` refreshes bundled servers from the aiworkspace template when they are missing from canonical, and preserves servers you added that are not in the template. If canonical already defines **`context7`**, sync leaves it unchanged (any transport or URL) — customize it there. For other bundled defaults, use per-project MCP (`<project>/.cursor/mcp.json`, nearest-wins).

On first use in a project, the tool asks you to approve the project MCP servers. Approve them to enable the tools.

Editor-specific team vs personal settings (Cursor, Claude, VS Code, Codex) live in `root-config/README.md`. Edit MCP servers only in `.agents/mcp.json`, then `npm run sync`.

## MCP authentication

Secret-bearing MCP servers load tokens from **`.env.local`** at the parent workspace root.

| Server type | How secrets load |
|-------------|------------------|
| **Stdio** with `${VAR}` | `npm run sync` wraps with `mcp-load-env.mjs` — reads `.env.local` automatically |
| **HTTP OAuth** | Editor sign-in (Slack, Atlassian, etc.) — no `.env.local` |
| **HTTP Bearer**, Claude Code | canonical's bare `${VAR}` resolves from the real process environment at connection time — no `.env.local` auto-load. Needs the one-time env load below just like Cursor. |
| **HTTP Bearer**, VS Code | twin gets `envFile` — reads `.env.local` directly |
| **HTTP Bearer**, Cursor | twin gets `${env:VAR}`; resolves from the real process environment at startup, not `envFile` — needs the one-time env load below |

**Setup (each developer, once):**

1. `cp .env.example .env.local` at the parent workspace root
2. Fill in tokens (never commit `.env.local`)
3. If you use HTTP Bearer MCP servers in **Cursor or Claude Code**, follow the env-loading step in `<workspace-repo>/setup.md` §4.1 (`<workspace-repo>` = this repo folder name)
4. Restart your editor

Check tokens and Cursor/Claude Code HTTP hints: `npm run mcp:check-secrets`
