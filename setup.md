# Engineering Setup Guide

One-time setup for engineers to use AI-assisted workflows.

## Prerequisites

- Node.js >= 18
- Git
- [Cursor IDE](https://cursor.com/) (or another AI editor: VS Code + Copilot, Claude Code, Antigravity, etc.)
- Access to your organization's GitHub repos

## 1. Workspace Layout

Keep all repos under a single root directory:

```
~/dev/<your-org>/
├── workspace/          # this repo
├── <project-a>/        # your app, service, etc.
├── <project-b>/
└── ...
```

This lets AI tools search across repos, reference files consistently, and share conventions.

## 2. Clone and Install

```bash
mkdir -p ~/dev/<your-org>
cd ~/dev/<your-org>
git clone <your-teams-workspace-repo> workspace
cd workspace && npm install
```

Open `~/dev/<your-org>` in Cursor as your workspace.

Your team's workspace repo is a fork of the [aiworkspace](https://github.com/a-tokyo/aiworkspace) template. Each team owns their copy — customize skills, docs, and `root-config/` freely. See [Upgrading](#upgrading) for how to pull template updates.

## 3. GitHub CLI

Useful for PRs, issues, and repo operations from the terminal:

```bash
brew install gh
gh auth login     # GitHub.com → HTTPS → web browser
gh auth status    # verify
```

## 4. MCP Servers

`npm install` mirrors MCP configs from `root-config/` to the parent workspace root automatically. No manual Cursor Settings setup needed.

The workspace ships configs for **all major tools** — Cursor, Claude Code, Codex, and VS Code. Every developer gets all of them; there is no per-tool opt-out. Unused symlinks are harmless. `npm install` and git hooks will recreate parent-root tool dirs if removed.

The workspace ships with **context7** — up-to-date library and framework documentation.

After install:

1. Open `~/dev/<your-org>/` in Cursor (or your AI editor)
2. Restart the editor if MCP servers don't appear immediately
3. Approve context7 on first use when prompted

Configs are symlinked from `root-config/`:

| Parent root | Points to |
|-------------|-----------|
| `.agents/mcp.json` | `workspace/root-config/.agents/mcp.json` (canonical) |
| `.mcp.json` | `.agents/mcp.json` (Claude Code) |
| `.cursor/mcp.json` | `../.agents/mcp.json` (Cursor) |
| `.codex/config.toml` | `workspace/root-config/.codex/config.toml` (Codex) |
| `.vscode/mcp.json` | `workspace/root-config/.vscode/mcp.json` (VS Code) |

To override MCP for a single project, add `<project>/.cursor/mcp.json` — nearest-wins.

To add more servers later, edit `root-config/.agents/mcp.json` only — `npm run sync` regenerates the Codex and VS Code twins from canonical. See `root-config/AGENTS.md`.

### 4.1 MCP secrets

MCP servers that need tokens load them from **`.env.local`** at the parent workspace root. Open the **parent directory** (not a single project repo) in your editor so MCP paths resolve correctly. `npm run sync` wraps secret-bearing **stdio** servers with a built-in env loader — no direnv, no terminal sourcing, no extra packages.

**One-time setup** (from parent workspace root):

```bash
cp .env.example .env.local   # fill in your tokens
```

Then **restart Cursor or Claude Code** (MCP reads config at startup).

`.env.local` is gitignored. `.env.example` lives in `root-config/` and is symlinked to the parent root. OAuth HTTP servers (e.g. Slack) use the editor's sign-in flow — no `.env.local` entry needed.

Run `npm run mcp:check-secrets` for a non-fatal hint if tokens are missing, `.env.local` is absent, or placeholders are still empty (also runs on every `postinstall`). It also warns about HTTP servers using a Bearer `${VAR}` header — Cursor cannot expand those from `.env.local`, so prefer the server's OAuth endpoint.

**Codex + OAuth HTTP servers:** the generated `.codex/config.toml` sets `experimental_use_rmcp_client = true` and emits a `url` for each HTTP server. For OAuth servers, run the one-time `codex mcp login <name>` (the sync output lists the exact commands). Note: GitHub's Copilot MCP (`api.githubcopilot.com/mcp/`) only supports OAuth for first-party clients (Cursor, VS Code, Claude); in Codex it requires a PAT via a Bearer `${VAR}` header instead — or just use Cursor/VS Code for GitHub.

## 5. AI Agent Environment

`npm install` sets up everything automatically:

1. Restores skills from `skills-lock.json`
2. Mirrors `root-config/` to parent root (symlinks files and directories)
3. Creates per-skill symlinks for each AI tool
4. Installs git hooks (post-merge, post-checkout) for auto-sync

```bash
cd ~/dev/<your-org>/workspace
npm install
npm run skills:list    # verify
```

### Managing Skills

```bash
npm run skills:add -- <source> [--project <repo>]     # add
npm run skills:remove -- [<skill>] [--project <repo>]  # remove
npm run skills:list                                     # list
npm run skills:update                                   # update all
npm run skills:create -- --name my-skill               # create manually
npm run skills:setup                                    # re-sync
```

Without `--project`: workspace-wide (installs to `root-config/.agents/skills/`). With `--project`: project-only (installs to `<repo>/.agents/skills/`).

### Using Skills

- **Cursor**: `@workspace/.agents/skills/<name>/SKILL.md` in chat
- **Codex, Amp, Gemini CLI**: auto-discovered from `.agents/skills/`

### Third-Party Docs

Use Cursor's `@Docs > Add new doc` for built-in indexing. For non-Cursor tools, create a `docs-3rdparty/` sibling repo.

## Upgrading

The workspace uses two git remotes:

| Remote | Points to | Purpose |
|--------|-----------|---------|
| `origin` | Your team's repo | Where your team pushes changes (skills, docs, configs) |
| `upstream` | The aiworkspace template | Source for script updates and bug fixes |

`npx aiworkspace init` sets up `upstream` automatically. Team members who clone from `origin` only have `origin` — `npm run upgrade` adds `upstream` on first run.

**Initial setup** (person who ran `init`):

```bash
git remote add origin <your-teams-workspace-repo>
git push -u origin main
```

**Pulling template updates** (anyone on the team):

```bash
npm run upgrade                # npm update aiworkspace + copy scripts/ (or git upstream fallback)
git diff --cached              # review what changed (both paths stage scripts/)
git commit -m "upgrade scripts from aiworkspace"
```

**Syncing config changes** (after editing `root-config/`, especially `.agents/mcp.json`):

```bash
npm run sync                   # regenerate MCP twins + mirror to parent root (no template bump)
git diff --cached              # review what changed
git commit -m "sync mcp configs"
```

New workspaces include `aiworkspace` in `devDependencies` so `npm outdated` shows when a newer template is on npm. Your team's own `version` in `package.json` stays independent.

`npm run upgrade` also chains workspace sync (MCP merge + parent-root symlinks). For MCP-only edits you do not need `upgrade` — use `sync`.

Only `scripts/` is updated from the template package (and lockfile if npm changed the devDep). MCP files are merged into your `root-config/` without overwriting your custom servers. Your other `root-config/` files (AGENTS.md, rules) and skills stay yours.

If you have no `aiworkspace` devDependency (older layout), upgrade uses `git fetch upstream` and checks out `scripts/` from `upstream/main` instead.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| context7 MCP not working | Ensure `npx` is available (`node -v`), restart Cursor, check MCP server status in Settings |
| MCP configs missing at parent root | `cd workspace && npm run sync` (or `npm run skills:setup`), verify `ls -la ../.agents/mcp.json` |
| Skills not showing up | `cd workspace && npm run skills:setup`, verify `ls root-config/.agents/skills/` |
| MCP server red/error | Click server name in Cursor Settings -> MCP for details, restart Cursor |
| `npm install` fails on postinstall | Run `node scripts/skills/setup-skills.mjs` manually to see errors |
| `npm run upgrade` fails | With `aiworkspace` in devDependencies: run `npm install` then retry. Without it: `git remote -v`, add upstream `https://github.com/a-tokyo/aiworkspace.git` |
