# AI Agent Skills

Shared AI agent skills and documentation for the workspace.

## Architecture

```
workspace/root-config/.agents/skills/    ← workspace-wide skills (git-tracked)
  ├── humanizer/SKILL.md                    shared with ALL projects
  └── ...

workspace/.agents/skills/                ← workspace project-specific skills (git-tracked)
  ├── refactor/SKILL.md                     available only within workspace/
  └── ...

<project>/.agents/skills/                ← project-specific skills
  ├── <skill-name>/SKILL.md                 available only within that project
  └── ...

Parent root (auto-created by setup-skills.mjs):
  .claude/skills/{name}  → workspace-wide skill symlinks  (Claude Code)
  skills/{name}          → workspace-wide skill symlinks  (OpenClaw)
  (Cursor reads .agents/skills/ natively — no .cursor/ symlinks needed)

Per-project (including workspace/):
  <project>/.claude/skills/{name}  → project skill symlinks
```

**Workspace-wide** skills live in `workspace/root-config/.agents/skills/`. Setup creates symlinks at the parent root so every AI tool across all projects finds them.

**Project-specific** skills live in `<project>/.agents/skills/` and are linked only inside that project. The workspace repo itself is treated as a project, so it can have its own skills in `workspace/.agents/skills/`.

## Why Skills?

Skills standardize how LLMs handle domain-specific tasks. Instead of explaining conventions each time, document them once and reference the skill.

**Example**: Without a tracking skill, every developer gets inconsistent event names (`"user_created"` vs `"User Created"`). With a skill, the LLM follows your conventions automatically.

## Commands

All commands run from `workspace/`:

```bash
npm run skills:add -- <source> [--project <repo>]      # add from registry
npm run skills:add -- owner/repo --skill <name>         # pick from multi-skill repo
npm run skills:remove -- [<skill>] [--project <repo>]   # remove
npm run skills:create -- --name my-skill [--project my-app]  # create manually
npm run skills:list                                      # list installed
npm run skills:update                                    # update all
npm run skills:check                                     # check for updates
npm run skills:find                                      # search registry
npm run skills:setup                                     # re-sync configs and symlinks
npm run upgrade                                          # pull latest scripts from upstream
```

## skills-lock.json

Git-tracked lock files recording each skill's source and hash. Enables `skills update` and `skills check`.

- `workspace/root-config/skills-lock.json` — workspace-wide skills
- `<project>/skills-lock.json` — project-specific skills (created by `skills:add --project <name>`)

Updates:
- **On clone**: `npm install` restores skills from lock, creates symlinks.
- **On add/remove**: CLI updates the lock automatically.
- **On update**: fetches latest from recorded sources.

## How Sync Works

1. `npm install` restores skills, mirrors root-config, creates symlinks, installs hooks
2. `git pull` / `git checkout` triggers hooks that re-sync
3. `skills:add` / `skills:remove` run setup after the CLI finishes

## Using Skills

- **Cursor**: `@workspace/.agents/skills/<name>/SKILL.md` in chat
- **Codex, Amp, Gemini CLI**: auto-discovered from `.agents/skills/`

## Creating a Skill Manually

```bash
npm run skills:create -- --name my-skill [--project my-app]
```

Edit the generated `SKILL.md`. Commit so the team gets it on pull.
