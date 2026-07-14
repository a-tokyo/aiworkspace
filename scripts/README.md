# Scripts

These scripts are managed by [aiworkspace](https://github.com/a-tokyo/aiworkspace). They are overwritten when you run `npm run upgrade`.

**Do not edit these files directly** unless you intend to maintain your own fork. Local changes will be lost on the next upgrade.

## What they do

| Script | Purpose |
|--------|---------|
| `lib.mjs` | Shared utilities (symlinks, dirs, lock files) |
| `sync.mjs` | Regenerate MCP twins and mirror root-config to parent root |
| `upgrade.mjs` | Pull latest scripts from aiworkspace npm package or git upstream |
| `upgrade-mcp.mjs` | MCP merge, Codex TOML + VS Code JSON projection, symlinks |
| `install-hooks.mjs` | Installs git hooks for post-merge/post-checkout auto-sync |
| `install-shell-profile.mjs` | Opt-in shell profile block for HTTP Bearer MCP env (Cursor) |
| `mcp-bearer-env-keys.mjs` | Print Bearer env var names from canonical `mcp.json` |
| `workspace-env.sh` / `workspace-env.ps1` | Source `.env.local`; macOS `launchctl` for Bearer keys |
| `skills/setup-skills.mjs` | Mirrors root-config to parent root, migrates local `settings.json` copies (seed/backup), creates skill symlinks |
| `skills/add-skill.mjs` | Wrapper around `skills add` with project routing and auto-setup |
| `skills/remove-skill.mjs` | Wrapper around `skills remove` with cleanup |
| `skills/create-skill.mjs` | Scaffolds a new manual skill directory |

`install-shell-profile.mjs` keeps two local, gitignored files: `scripts/.mcp-env.paths` (cached node
binary path + Bearer key names) and `local/.mcp-env.id` (a per-clone id so multiple aiworkspace clones
on one machine each get their own shell-profile block). `.mcp-env.id` lives in `local/`, not `scripts/`,
because `npm run upgrade` replaces `scripts/` wholesale.

## Upgrading and syncing

**Template upgrade** — when a new aiworkspace release is published:

```bash
npm run upgrade
```

**Config sync** — after editing `root-config/` (especially `.agents/mcp.json`):

```bash
npm run sync
```

If `aiworkspace` is listed in `devDependencies`, `upgrade` runs `npm update aiworkspace` and copies `node_modules/aiworkspace/scripts/` into `scripts/`. That pins which published template version your scripts match (see `package-lock.json`). `upgrade` chains `sync` automatically.

If there is no `aiworkspace` dependency (older workspaces), `upgrade` falls back to `git fetch upstream` and checks out `scripts/` from `upstream/main`. Your `root-config/`, skills, and team-owned `package.json` fields stay yours; only `scripts/` is replaced.

## Customizing

If you need to modify a script, consider these options first:

1. **Open an issue or PR** on the [aiworkspace repo](https://github.com/a-tokyo/aiworkspace) so everyone benefits.
2. **Add a new script** in this directory rather than modifying an existing one -- new files won't be overwritten by upgrade.
3. **Fork the template** if your team needs persistent divergence. Update the `upstream` remote to point to your fork.
