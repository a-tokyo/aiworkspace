#!/usr/bin/env node

/**
 * postinstall.mjs — Cross-platform postinstall hook.
 *
 * Restores skills from lock files, syncs configs, and installs git hooks.
 * Replaces inline shell script to work on Windows (cmd.exe) and Unix.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_DIR, ROOT_CONFIG, resolveSkillsBin, nonInteractiveGitEnv } from "./lib.mjs";

// When installed as a devDependency, REPO_DIR is .../node_modules/aiworkspace — skip.
// Check specifically for node_modules/aiworkspace to avoid false positives on
// workspaces that happen to live under an unrelated node_modules path.
const segments = REPO_DIR.split(sep);
const nmIdx = segments.lastIndexOf("node_modules");
if (nmIdx !== -1 && segments[nmIdx + 1] === "aiworkspace") {
  process.exit(0);
}

function lockHasSkills(cwd) {
  try {
    const lock = JSON.parse(readFileSync(join(cwd, "skills-lock.json"), "utf8"));
    return Object.keys(lock?.skills ?? {}).length > 0;
  } catch { return false; }
}

function trySkillsInstall(cwd) {
  // Nothing to restore — stay quiet (fresh scaffolds have an empty lock).
  if (!lockHasSkills(cwd)) return;
  try {
    const bin = resolveSkillsBin();
    const useLocal = existsSync(bin);
    // Prefer the installed bin over `npx` (npx adds a resolution path that can
    // stall or hit the registry). Stream progress — swallowing it (stdio:"ignore")
    // is what made a slow multi-clone restore look frozen with no output.
    console.log("Restoring skills from skills-lock.json (first run may take a moment)…");
    const result = spawnSync(
      useLocal ? bin : "npx",
      useLocal ? ["experimental_install"] : ["skills", "experimental_install"],
      {
        cwd,
        stdio: "inherit",
        timeout: 300_000,
        killSignal: "SIGKILL",
        env: nonInteractiveGitEnv(),
        shell: process.platform === "win32",
      },
    );
    if (result.signal) {
      console.warn(`  ⚠ Skill restore timed out — run \`npm run skills:setup\` later.`);
    }
  } catch { /* best-effort */ }
}

function exitOnFail(result, label) {
  if (result.error) { console.error(`${label}: ${result.error.message}`); process.exit(1); }
  if (result.status !== 0 && result.status !== null) process.exit(result.status);
  if (result.status === null) { console.error(`${label}: killed by ${result.signal || "unknown"}`); process.exit(1); }
}

trySkillsInstall(REPO_DIR);
trySkillsInstall(ROOT_CONFIG);

const node = process.execPath;

const setup = spawnSync(node, [join("scripts", "skills", "setup-skills.mjs"), "--ensure"], {
  cwd: REPO_DIR,
  stdio: "inherit",
});
exitOnFail(setup, "setup-skills.mjs");

const hooks = spawnSync(node, [join("scripts", "install-hooks.mjs")], {
  cwd: REPO_DIR,
  stdio: "inherit",
});
exitOnFail(hooks, "install-hooks.mjs");

spawnSync(node, [join("scripts", "mcp-check-secrets.mjs")], {
  cwd: REPO_DIR,
  stdio: "inherit",
});
