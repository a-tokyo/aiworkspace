#!/usr/bin/env node

/**
 * postinstall.mjs — Cross-platform postinstall hook.
 *
 * Restores skills from lock files, syncs configs, and installs git hooks.
 * Replaces inline shell script to work on Windows (cmd.exe) and Unix.
 */

import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_DIR, ROOT_CONFIG } from "./lib.mjs";

function trySkillsInstall(cwd) {
  try {
    spawnSync("npx", ["skills", "experimental_install"], {
      cwd,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
  } catch { /* best-effort */ }
}

function exitOnFail(result, label) {
  if (result.error) { console.error(`${label}: ${result.error.message}`); process.exit(1); }
  if (result.status !== 0 && result.status !== null) process.exit(result.status);
  if (result.status === null) { console.error(`${label}: killed by ${result.signal || "unknown"}`); process.exit(1); }
}

trySkillsInstall(REPO_DIR);
trySkillsInstall(ROOT_CONFIG);

const setup = spawnSync("node", [join("scripts", "skills", "setup-skills.mjs"), "--ensure"], {
  cwd: REPO_DIR,
  stdio: "inherit",
});
exitOnFail(setup, "setup-skills.mjs");

const hooks = spawnSync("node", [join("scripts", "install-hooks.mjs")], {
  cwd: REPO_DIR,
  stdio: "inherit",
});
exitOnFail(hooks, "install-hooks.mjs");
