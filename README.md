# AI Workspace

Manage shared AI agent skills, configs, and automation across multi-repo workspaces. Works with Cursor, Claude Code, Codex, Amp, and 40+ AI coding tools.

<a href="https://npmjs.com/package/aiworkspace">
  <img src="https://img.shields.io/npm/v/aiworkspace.svg" alt="npm version" />
  <img src="https://img.shields.io/npm/dt/aiworkspace.svg" alt="npm downloads" />
</a>
<a href="https://twitter.com/intent/follow?screen_name=ahmedtokyo"><img src="https://img.shields.io/twitter/follow/ahmedtokyo.svg?label=Follow%20@ahmedtokyo" alt="Follow @ahmedtokyo" /></a>

<br />

**The problem**: AI agents only see the repo they run in. An agent working in a frontend repo has no visibility into the backend, API contracts, or shared conventions -- so it assumes and hallucinates. On top of that, each developer configures AI tools differently, so skills, instructions, rules, and MCP servers drift between projects and team members.

**The solution**: A single `workspace/` repo that acts as the canonical source. Running `npm install` mirrors configs to the parent root, symlinks skills and MCP servers for every AI tool, and installs git hooks to keep everything in sync.

## Quick Start

**Create a new workspace** (one-time, by whoever sets it up):

```bash
mkdir ~/dev/<your-org> && cd ~/dev/<your-org>
npx aiworkspace init
cd workspace
git remote add origin <your-repo-url>
git push -u origin main
```

**Join an existing workspace** (every other team member):

```bash
cd ~/dev/<your-org>
git clone <your-teams-workspace-repo> workspace
cd workspace && npm install
```

`npm install` restores skills from the lockfile, mirrors configs to the parent root, creates skill symlinks, and installs git hooks. See [setup.md](setup.md) for the full guide — including [MCP secrets](setup.md#41-mcp-secrets) (`cp .env.example .env.local`, restart editor).

## How It Works

```
~/dev/<your-org>/                       <- open this in Cursor / your editor
├── workspace/                          <- this repo
│   ├── root-config/                    <- canonical source for root-level AI configs
│   │   ├── AGENTS.md                   <- standing instructions for all AI tools
│   │   ├── .agents/mcp.json            <- canonical MCP servers (single source of truth)
│   │   ├── .agents/skills/             <- workspace-wide skills
│   │   ├── .mcp.json, .cursor/, .codex/, .vscode/   <- per-editor configs (symlinked or generated)
│   │   ├── .env.example                <- template for MCP secrets (-> .env.local at root)
│   │   └── skills-lock.json            <- lockfile for workspace-wide skills
│   ├── .agents/skills/                 <- workspace project-specific skills
│   ├── scripts/                        <- automation (setup, hooks, skill wrappers)
│   └── package.json
├── <project-a>/                        <- your app / service / library
├── <project-b>/
└── ...
```

The setup script walks `root-config/` generically. Add new config types (Cursor rules, Claude settings, Codex config) and they sync automatically with no script changes.

## Knowledge Hierarchy

Everything follows **nearest-wins**: the closer a file is to the code being changed, the higher its priority.

| What | Workspace-wide | Per-project |
|------|---------------|-------------|
| Instructions | `root-config/AGENTS.md` synced to root | `<project>/AGENTS.md` |
| Skills | `root-config/.agents/skills/` symlinked everywhere | `<project>/.agents/skills/` |
| Cursor rules | `root-config/.cursor/rules/` symlinked | `<project>/.cursor/rules/` |
| Cursor settings | `root-config/.cursor/settings.json` symlinked | — |
| MCP servers | `root-config/.agents/mcp.json` synced to root | `<project>/.cursor/mcp.json` |
| Docs | `docs/` repo (sibling) | `<project>/docs/` |

## Skills

```bash
npm run skills:add -- <source> [--project <repo>]      # add from registry
npm run skills:add -- owner/repo --skill <name>         # pick from multi-skill repo
npm run skills:remove -- [<skill>] [--project <repo>]   # remove
npm run skills:create -- --name my-skill                # create manually
npm run skills:list                                      # list installed
npm run skills:find                                      # search skill registry
npm run skills:update                                    # update all
npm run skills:check                                     # check for available updates
npm run skills:setup                                     # re-sync configs and symlinks
```

Without `--project`, skills install to `root-config/.agents/skills/` (workspace-wide). With `--project <repo>`, they go to `<repo>/.agents/skills/` (project-only).

Skills are tracked in `skills-lock.json` (source + hash). On `npm install`, they are restored from the lockfile automatically.

## MCP

MCP servers give agents shared tools. Define them once in `root-config/.agents/mcp.json` and every editor picks them up — no per-developer setup. [context7](https://github.com/upstash/context7) (up-to-date library docs) ships bundled.

| File | Editor | How |
|------|--------|-----|
| `.agents/mcp.json` | — | canonical, edit this one |
| `.mcp.json` | Claude Code | symlink |
| `.cursor/mcp.json` | Cursor | generated on sync |
| `.vscode/mcp.json` | VS Code / Copilot | generated on sync |
| `.codex/config.toml` | Codex | generated on sync |

To add or change a server, edit `.agents/mcp.json`, then regenerate the twins and symlinks:

```bash
npm run sync
```

Sync refreshes bundled servers from the aiworkspace template and preserves any servers you added. Local edits to a *bundled* server are overwritten on the next sync — to override one for a single repo, use `<project>/.cursor/mcp.json` (nearest-wins).

To drop a bundled server entirely, list it in `root-config/.agents/mcp-disabled.json` (`{ "disabled": ["context7"] }`) — deleting it from `.agents/mcp.json` alone won't stick, since sync restores bundled servers from the template.

**Secrets.** Servers that need tokens read them from `.env.local` at the parent workspace root:

```bash
cp .env.example .env.local     # then fill in tokens, and restart your editor
npm run mcp:check-secrets      # verify tokens are present
```

Stdio servers using `${VAR}` are wrapped automatically to load `.env.local`. See [setup.md §4.1](setup.md#41-mcp-secrets) for HTTP Bearer servers in Cursor and OAuth sign-in for Codex.

**Env var naming.** If you load `.env.local` into your shell (via `npm run mcp:install-shell` or a manual `source` in `~/.zshrc`), those keys become part of your login environment. Prefer a workspace-specific prefix on secret names in `.env.example` and `mcp.json` (e.g. `ACME_SONAR_TOKEN` instead of `SONAR_TOKEN`) so they do not collide with other tools or projects. Stdio-only secrets that stay inside the MCP env loader are less exposed, but a consistent prefix keeps Bearer and stdio configs aligned. To avoid a login profile entirely, see [setup.md §4.1](setup.md#41-mcp-secrets) (terminal launch).

## Upgrading

**Template upgrade** — pull latest managed `scripts/` when a new aiworkspace release is published:

```bash
npm run upgrade
```

**Config sync** — after editing `root-config/` (especially `.agents/mcp.json`), regenerate MCP twins and parent-root symlinks without bumping the template:

```bash
npm run sync
```

If `aiworkspace` is in `devDependencies`, `upgrade` updates that package from npm and copies its `scripts/` into yours (your team's `version` field stays independent). Otherwise the workspace falls back to git: `upstream` remote + `upstream/main` for `scripts/`. `upgrade` chains `sync` automatically. `npx aiworkspace init` sets `upstream` automatically. See [setup.md](setup.md) for details.

## Requirements

- Node.js >= 18
- Git

## Related resources

[agent-skills](https://github.com/a-tokyo/agent-skills) is a companion collection of reusable agent skills — browse on [skills.sh](https://www.skills.sh/a-tokyo/agent-skills). Install any of them with the same `skills:add` workflow documented above.

| Skill | What it does |
|-------|-------------|
| [production-grade](https://skills.sh/a-tokyo/agent-skills/production-grade) | Engineering posture for non-trivial work: plan before code, simplest-correct solution first, production hardening patterns. |
| [tribunal](https://skills.sh/a-tokyo/agent-skills/tribunal) | Doer → verifier panel → consensus loop to gate deliverables before ship. |

More skills in the collection — see the [full catalog](https://github.com/a-tokyo/agent-skills#skills).

```bash
npm run skills:add -- a-tokyo/agent-skills --skill production-grade
```

## License

Apache-2.0
