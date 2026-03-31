# AI Workspace

Manage shared AI agent skills, configs, and automation across multi-repo workspaces. Works with Cursor, Claude Code, Codex, Amp, and 40+ AI coding tools.

<a href="https://npmjs.com/package/aiworkspace">
  <img src="https://img.shields.io/npm/v/aiworkspace.svg" alt="npm version" />
  <img src="https://img.shields.io/npm/dt/aiworkspace.svg" alt="npm downloads" />
</a>
<a href="https://twitter.com/intent/follow?screen_name=ahmedtokyo"><img src="https://img.shields.io/twitter/follow/ahmedtokyo.svg?label=Follow%20@ahmedtokyo" alt="Follow @ahmedtokyo" /></a>

<br />

**The problem**: AI agents only see the repo they run in. An agent working in a frontend repo has no visibility into the backend, API contracts, or shared conventions -- so it assumes and hallucinates. On top of that, each developer configures AI tools differently, so skills, instructions, and rules drift between projects and team members.

**The solution**: A single `workspace/` repo that acts as the canonical source. Running `npm install` mirrors configs to the parent root, symlinks skills for every AI tool, and installs git hooks to keep everything in sync.

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

`npm install` restores skills from the lockfile, mirrors configs to the parent root, creates skill symlinks, and installs git hooks. See [setup.md](setup.md) for the full guide.

## How It Works

```
~/dev/<your-org>/                       <- open this in Cursor / your editor
├── workspace/                          <- this repo
│   ├── root-config/                    <- canonical source for root-level AI configs
│   │   ├── AGENTS.md                   <- standing instructions for all AI tools
│   │   ├── .agents/skills/             <- workspace-wide skills
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

## Upgrading

```bash
npm run upgrade
```

If `aiworkspace` is in `devDependencies`, this updates that package from npm and copies its `scripts/` into yours (your team's `version` field stays independent). Otherwise the workspace falls back to git: `upstream` remote + `upstream/main` for `scripts/`. `npx aiworkspace init` sets `upstream` automatically. See [setup.md](setup.md) for details.

## Requirements

- Node.js >= 18
- Git

## License

Apache-2.0
