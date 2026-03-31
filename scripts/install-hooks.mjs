#!/usr/bin/env node

/**
 * @managed by aiworkspace — https://github.com/a-tokyo/aiworkspace
 * This file is overwritten by `npm run upgrade`. Edit with care.
 *
 * install-hooks.mjs — Git hooks that auto-sync skills after pull/checkout.
 *
 * Installs post-merge and post-checkout hooks in this repo's .git/hooks/.
 * Both call `setup-skills.mjs --ensure` (idempotent, ~50ms when nothing changed).
 *
 * Safe: won't overwrite hooks not created by this script (checks marker comment).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "./lib.mjs";

const GIT_DIR = join(REPO_DIR, ".git");
const HOOKS_DIR = join(GIT_DIR, "hooks");

const MARKER = "# workspace-skills-auto-setup";
const HOOK_BODY = `#!/bin/sh
${MARKER}
# Auto-generated — do not edit. Re-run: cd workspace && npm run postinstall
node scripts/skills/setup-skills.mjs --ensure || echo "⚠ skills auto-setup failed; run: cd workspace && npm run skills:setup" >&2
`;

if (!existsSync(GIT_DIR)) process.exit(0);
if (!existsSync(HOOKS_DIR)) mkdirSync(HOOKS_DIR, { recursive: true });

for (const hook of ["post-merge", "post-checkout"]) {
  const path = join(HOOKS_DIR, hook);

  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    if (!existing.includes(MARKER)) {
      console.log(`  ⚠ .git/hooks/${hook} exists (not ours) — skipping`);
      continue;
    }
  }

  writeFileSync(path, HOOK_BODY);
  chmodSync(path, 0o755);
  console.log(`  ✓ Installed .git/hooks/${hook}`);
}
