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

- `context7` — up-to-date documentation for libraries, frameworks, and tools.

These are defined once and shared across tools, the same way `AGENTS.md` and skills are. The canonical config is `.agents/mcp.json`. Claude Code and Cursor use the identical JSON schema, so they link straight to it. Codex (TOML) and VS Code (a different JSON schema) cannot share the file, so they have small hand-maintained twins.

```
.agents/mcp.json            canonical config (JSON)
.mcp.json        -> .agents/mcp.json      Claude Code
.cursor/mcp.json -> ../.agents/mcp.json   Cursor
.codex/config.toml          Codex (TOML twin)
.vscode/mcp.json            VS Code and Copilot (JSON twin, "servers" schema)
```

To add or change a server, edit `.agents/mcp.json`, then make the matching change in `.codex/config.toml` and `.vscode/mcp.json`. The two symlinked tools pick it up automatically.

All tool configs are mirrored for every developer — Cursor, Claude Code, Codex, and VS Code. There is no opt-out; unused configs are inert. To override workspace-wide MCP for one repo, use `<project>/.cursor/mcp.json` (nearest-wins).

On first use in a project, the tool asks you to approve the project MCP servers. Approve them to enable the tools.
