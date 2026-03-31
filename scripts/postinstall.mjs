#!/usr/bin/env node

/**
 * postinstall.mjs — Cross-platform postinstall hook.
 *
 * Restores skills from lock files, syncs configs, and installs git hooks.
 * Replaces inline shell script to work on Windows (cmd.exe) and Unix.
 */

import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_CONFIG = join(REPO_DIR, "root-config");

function trySkillsInstall(cwd) {
  try {
    spawnSync("npx", ["skills", "experimental_install"], {
      cwd,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
  } catch { /* best-effort */ }
}

trySkillsInstall(REPO_DIR);
trySkillsInstall(ROOT_CONFIG);

const setup = spawnSync("node", [join("scripts", "skills", "setup-skills.mjs"), "--ensure"], {
  cwd: REPO_DIR,
  stdio: "inherit",
});
if (setup.status) process.exit(setup.status);

const hooks = spawnSync("node", [join("scripts", "install-hooks.mjs")], {
  cwd: REPO_DIR,
  stdio: "inherit",
});
if (hooks.status) process.exit(hooks.status);
