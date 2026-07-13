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

MCP servers that need tokens load them from **`.env.local`** at the parent workspace root. Open the **parent directory** (not a single project repo) in your editor so MCP paths resolve correctly.

**One-time setup** (from parent workspace root):

```bash
cp .env.example .env.local   # fill in your tokens
```

Then **restart your editor** (MCP reads config at startup).

`.env.local` is gitignored. `.env.example` lives in `root-config/` and is symlinked to the parent root. OAuth HTTP servers (e.g. Slack) use the editor's sign-in flow — no `.env.local` entry needed.

**Prefix secret keys when loading into a shell.** Bearer tokens for Cursor are often loaded via `mcp:install-shell` or a manual `source` of `.env.local` in `~/.zshrc` / `~/.bashrc`. Those variables then live in your login shell (and on macOS, may be pushed to `launchctl` for Dock-launched apps). Use a workspace-specific prefix in `.env.example` and matching `${env:VAR}` / `${VAR}` placeholders in `mcp.json` — for example `ACME_SONAR_TOKEN` rather than `SONAR_TOKEN` — to avoid clashing with other projects, CLI tools, or generic names. Keep the same names in `.env.local`, `mcp.json`, and `.env.example`.

#### Stdio servers (automatic)

`npm run sync` wraps secret-bearing **stdio** servers that use `${VAR}` placeholders with a built-in env loader (`mcp-load-env.mjs`). Those read `.env.local` directly — no shell profile changes, no direnv, no extra packages.

Cursor also supports `envFile: "${workspaceFolder}/.env.local"` on stdio servers natively; the env loader is the workspace default so secrets work the same in Claude Code and other tools.

#### HTTP servers with Bearer tokens (Cursor one-time step)

Some remote MCP servers have no OAuth endpoint and need a Bearer token in `headers`, for example:

```json
"headers": {
  "Authorization": "Bearer ${env:SONAR_TOKEN}"
}
```

Use Cursor's `${env:NAME}` syntax in canonical `mcp.json` for HTTP headers (not plain `${NAME}`).

| Editor | How the token is loaded |
|--------|-------------------------|
| **VS Code** | Sync adds `envFile: "${workspaceFolder}/.env.local"` to the MCP twin |
| **Codex** | `bearer_token_env_var` in `.codex/config.toml` — set the var in your shell |
| **Cursor** | `${env:NAME}` reads from the **process environment at Cursor startup** — not from `envFile` (stdio only) |

So for **Cursor**, load Bearer tokens into the process environment before Cursor starts.

**Recommended (all platforms)** — from your workspace repo:

```bash
cd path/to/your-workspace-repo
npm run mcp:install-shell
```

This appends a marked block to your shell profile (`~/.zshrc`, `~/.bashrc`, and/or PowerShell `$PROFILE`). On macOS it also runs `launchctl setenv` for Bearer keys so Dock-launched Cursor inherits them. Re-run after moving the repo or changing Bearer vars in `mcp.json`. Remove with `npm run mcp:uninstall-shell`.

**Windows GUI apps:** add `--persist` to write User environment variables from `.env.local`:

```bash
npm run mcp:install-shell -- --persist
```

**Without a login profile** — vars stay in one terminal session only (Dock-launched Cursor won't see them):

```bash
cd ~/dev/<your-org>
set -a && source .env.local && set +a && cursor .
```

`direnv` with `dotenv .env.local` works the same if you use it. Prefer OAuth MCP servers when you can; VS Code loads Bearer tokens from `.env.local` via `envFile` without a shell step.

**Manual fallback (macOS / Linux)** — add to `~/.zshrc` or `~/.bashrc` (adjust the path to your parent workspace root):

```bash
[ -f "$HOME/dev/<your-org>/.env.local" ] && set -a && source "$HOME/dev/<your-org>/.env.local" && set +a
```

**Manual fallback (Windows PowerShell)** — add to your PowerShell profile, or run before starting Cursor:

```powershell
$envFile = "$env:USERPROFILE\dev\<your-org>\.env.local"
if (Test-Path $envFile) { Get-Content $envFile | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() } } }
```

Alternatively, set **User environment variables** manually (Settings → System → Environment variables) from the keys in `.env.local`.

Restart Cursor after changes. If Bearer headers still send the literal `${env:VAR}` string, Cursor did not inherit the variables:

- **macOS:** launch Cursor from Terminal after `source ~/.zshrc`, or set session vars with `launchctl setenv` before opening from Dock
- **Linux:** add vars to `/etc/environment` or `~/.pam_environment`, or always launch from a login shell
- **Windows:** use User/System environment variables and fully restart Cursor (not just reload window)

Prefer OAuth HTTP servers (`{ "type": "http", "url": "..." }` with no Bearer header) whenever the provider supports it.

Run `npm run mcp:check-secrets` for a non-fatal hint if tokens are missing, `.env.local` is absent, placeholders are still empty, or HTTP Bearer servers need the Cursor shell step above (also runs on every `postinstall`).

**Codex + OAuth HTTP servers:** the generated `.codex/config.toml` sets `experimental_use_rmcp_client = true` and emits a `url` for each HTTP server. For OAuth servers, run the one-time `codex mcp login <name>` (the sync output lists the exact commands). Note: GitHub's Copilot MCP (`api.githubcopilot.com/mcp/`) only supports OAuth for first-party clients (Cursor, VS Code, Claude); in Codex it requires a PAT via a Bearer `${env:VAR}` header instead — or just use Cursor/VS Code for GitHub.

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

### Claude Code (one-time)

`npm install` mirrors team `settings.json` to the parent root. For personal MCP enable toggles, copy the example once (sync never overwrites your live file):

```bash
cp <workspace-repo>/root-config/.claude/settings.local.json.example .claude/settings.local.json
```

Edit locally — remove servers you do not use. MCP **definitions** stay in `.agents/mcp.json`; `enabledMcpjsonServers` only controls which servers Claude Code activates for you.

### Team vs personal by editor

| Tool | Team (mirrored on sync) | Personal (never mirrored) |
|------|-------------------------|---------------------------|
| **All** | `AGENTS.md`, `.agents/mcp.json` | `.env.local` (secrets) |
| **Claude** | `.claude/settings.json` | `.claude/settings.local.json` |
| **Cursor** | `.cursor/rules/`, `.cursor/mcp.json` | User settings, MCP enable in Settings → MCP |
| **VS Code** | `.vscode/settings.json`, `extensions.json`, `mcp.json` | User settings, MCP UI |
| **Codex** | `config.toml` preamble, `.codex/rules/` | `~/.codex/config.toml`, `codex mcp login` |

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
| HTTP MCP Bearer auth fails in Cursor | See `<workspace-repo>/setup.md` §4.1 — Unix: `~/.zshrc` source line; Windows: User env vars or PowerShell profile |
| `npm install` fails on postinstall | Run `node scripts/skills/setup-skills.mjs` manually to see errors |
| `npm run upgrade` fails | With `aiworkspace` in devDependencies: run `npm install` then retry. Without it: `git remote -v`, add upstream `https://github.com/a-tokyo/aiworkspace.git` |
