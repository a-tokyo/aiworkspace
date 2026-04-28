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
