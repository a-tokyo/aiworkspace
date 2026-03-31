#!/usr/bin/env node

/**
 * postinstall.mjs — Cross-platform postinstall hook.
 *
 * Restores skills from lock files, syncs configs, and installs git hooks.
 * Replaces inline shell script to work on Windows (cmd.exe) and Unix.
 */

import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_DIR, ROOT_CONFIG } from "./lib.mjs";

// When installed as a devDependency, REPO_DIR is .../node_modules/aiworkspace — skip.
// Check specifically for node_modules/aiworkspace to avoid false positives on
// workspaces that happen to live under an unrelated node_modules path.
const segments = REPO_DIR.split(sep);
const nmIdx = segments.lastIndexOf("node_modules");
if (nmIdx !== -1 && segments[nmIdx + 1] === "aiworkspace") {
  process.exit(0);
}

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
