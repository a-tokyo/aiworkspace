# Scripts

These scripts are managed by [aiworkspace](https://github.com/a-tokyo/aiworkspace). They are overwritten when you run `npm run upgrade`.

**Do not edit these files directly** unless you intend to maintain your own fork. Local changes will be lost on the next upgrade.

## What they do

| Script | Purpose |
|--------|---------|
| `lib.mjs` | Shared utilities (symlinks, dirs, lock files) |
| `install-hooks.mjs` | Installs git hooks for post-merge/post-checkout auto-sync |
| `skills/setup-skills.mjs` | Mirrors root-config to parent root, creates skill symlinks |
| `skills/add-skill.mjs` | Wrapper around `skills add` with project routing and auto-setup |
| `skills/remove-skill.mjs` | Wrapper around `skills remove` with cleanup |
| `skills/create-skill.mjs` | Scaffolds a new manual skill directory |

## Upgrading

```bash
npm run upgrade
```

If `aiworkspace` is listed in `devDependencies`, this runs `npm update aiworkspace` and copies `node_modules/aiworkspace/scripts/` into `scripts/`. That pins which published template version your scripts match (see `package-lock.json`).

If there is no `aiworkspace` dependency (older workspaces), it falls back to `git fetch upstream` and checks out `scripts/` from `upstream/main`. Your `root-config/`, skills, and team-owned `package.json` fields stay yours; only `scripts/` is replaced.

## Customizing

If you need to modify a script, consider these options first:

1. **Open an issue or PR** on the [aiworkspace repo](https://github.com/a-tokyo/aiworkspace) so everyone benefits.
2. **Add a new script** in this directory rather than modifying an existing one -- new files won't be overwritten by upgrade.
3. **Fork the template** if your team needs persistent divergence. Update the `upstream` remote to point to your fork.
