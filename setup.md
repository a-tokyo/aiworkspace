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

The GitHub MCP server uses `gh`:

```bash
brew install gh
gh auth login     # GitHub.com → HTTPS → web browser
gh auth status    # verify
```

## 4. GitHub MCP Server

1. Cursor Settings (`Cmd+Shift+J`) → **MCP** → **+ Add new MCP server**
2. Name: `github`
3. Uses your `gh` CLI auth — no extra tokens needed

Manual config (if prompted):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-pat>" }
    }
  }
}
```

## 5. Other MCP Servers (Optional)

Add any others your team uses via Cursor Settings → MCP:

| Server | What it gives the AI |
|--------|---------------------|
| Atlassian | Jira issues, Confluence docs |
| Linear | Issues, projects |
| Slack | Channel history, search |
| Sentry | Error reports, stack traces |

Verify: ask the agent "List my Jira projects" or "Search Confluence for..." to confirm connectivity.

## 6. AI Agent Environment

`npm install` sets up everything automatically:

1. Restores skills from `skills-lock.json`
2. Mirrors `root-config/` to parent root (copies files, symlinks directories)
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

New workspaces include `aiworkspace` in `devDependencies` so `npm outdated` shows when a newer template is on npm. Your team's own `version` in `package.json` stays independent.

Only `scripts/` is updated (and lockfile if npm changed the devDep). Your `root-config/`, skills, and the rest of `package.json` stay yours.

If you have no `aiworkspace` devDependency (older layout), upgrade uses `git fetch upstream` and checks out `scripts/` from `upstream/main` instead.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| GitHub MCP not working | `gh auth status`, restart Cursor, check MCP server status |
| Skills not showing up | `cd workspace && npm run skills:setup`, verify `ls root-config/.agents/skills/` |
| MCP server red/error | Click server name in Cursor Settings -> MCP for details, restart Cursor |
| `npm install` fails on postinstall | Run `node scripts/skills/setup-skills.mjs` manually to see errors |
| `npm run upgrade` fails | With `aiworkspace` in devDependencies: run `npm install` then retry. Without it: `git remote -v`, add upstream `https://github.com/a-tokyo/aiworkspace.git` |
