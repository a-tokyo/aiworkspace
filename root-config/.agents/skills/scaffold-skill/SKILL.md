---
name: scaffold-skill
description: >-
  Scaffold new AI agent skills with proper symlinking across all IDE tools
  (Cursor, Claude Code, Codex, etc.). Use when creating a new skill, adding a
  local skill, or when the user wants to write a custom skill -- either
  workspace-wide or for a specific project.
---

# Scaffold Skill

Creates new skills using the workspace script, which handles name validation,
directory placement, and symlinking to all AI tool directories.

## Workflow

### 1. Decide scope

Ask the user if unclear.

- **Workspace-wide**: stored in `root-config/.agents/skills/`, symlinked to the
  workspace root so all projects and AI tools (`.agents/skills/`, `.claude/skills/`,
  `skills/`) can discover it.
- **Project-specific**: stored in `<repo>/.agents/skills/`, symlinked into that
  project's AI tool directories only.

### 2. Scaffold

Run from the `workspace/` directory:

```bash
# Workspace-wide
npm run skills:create -- --name <skill-name>

# Project-specific
npm run skills:create -- --name <skill-name> --project <repo>
```

This validates the name, creates the directory with a template `SKILL.md`, and
runs setup to symlink the skill into `.claude/skills/` and
`skills/` so every AI tool can discover it.

**Naming rules**: lowercase letters, numbers, hyphens, underscores, and dots.
Max 64 chars. Must start and end with a letter or number.

### 3. Write content

**Do not write the SKILL.md content directly.** Delegate to your IDE's
skill-authoring guide for quality content and proper requirements gathering.

1. Search your available skills for one named `create-skill`. Common locations:
   - Cursor: `~/.agents/skills/create-skill/SKILL.md`
   - Claude Code: `~/.claude/skills/create-skill/SKILL.md`
   - Or check your available skills list for any skill with "create-skill" in
     the name or "skill" + "create" in the description.

2. **If found**: Read it and follow its **complete workflow** from the start --
   including any discovery or requirements-gathering phase (asking the user
   questions about purpose, triggers, format, etc.). Use the scaffolded
   `SKILL.md` as your starting point; the guide tells you how to fill it in.

3. **If not found**: Edit the generated `SKILL.md` directly:
   - Replace the placeholder `description` with a specific, third-person
     description that includes both WHAT the skill does and WHEN to use it.
   - Replace the placeholder body with clear instructions and examples.
   - Keep the file under 500 lines.

### 4. Verify

Confirm the skill appears in the expected locations:

```bash
npm run skills:list
```

## Fallback (no shell access)

If you cannot run the script, create the skill directory and `SKILL.md` manually
under the correct `.agents/skills/` path. Then ask the user to run:

```bash
cd workspace && npm run skills:setup
```

This re-syncs all symlinks.
