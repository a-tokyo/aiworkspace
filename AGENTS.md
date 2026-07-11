# AI Workspace

This is the `workspace/` repo — central hub for shared AI config in a multi-repo workspace.

## Structure

- `workspace/root-config/` — Canonical source for root-level AI configs (AGENTS.md, workspace-wide skills, tool dirs). See `workspace/root-config/README.md`.
- `workspace/scripts/` — Automation: setup, hooks, skill wrappers.
- `workspace/.agents/skills/` — Workspace project-specific skills (available only within this repo).

## Key Commands

| Command | What it does |
|---------|-------------|
| `npm run skills:setup` | Mirror root-config to parent root, create skill symlinks |
| `npm run skills:add -- <source>` | Install a skill (workspace-wide) |
| `npm run skills:add -- <source> --project <repo>` | Install a skill (project-only) |
| `npm run skills:remove` | Remove a skill |
| `npm run skills:create -- --name <name>` | Create a manual skill scaffold |
| `npm run sync` | Regenerate MCP twins and mirror root-config to parent root |
| `npm run upgrade` | Pull latest scripts from upstream |

## Conventions

- Edit `workspace/root-config/AGENTS.md`, not the root copy (it gets overwritten on sync).
- Skills in `workspace/root-config/.agents/skills/` are workspace-wide (shared with all projects).
- Skills in `workspace/.agents/skills/` are specific to this repo.
- Use `--project <repo>` to install skills into a specific project.
- The setup script is generic: adding configs to `workspace/root-config/` requires no script changes.
- `postinstall` restores skills from lock, runs setup, installs git hooks.

## Code Quality

- Config precedence: always use the nearest config file to the code you are changing.
