#!/usr/bin/env node

/**
 * upgrade.mjs — Pull latest scripts from the upstream aiworkspace template.
 *
 * Cross-platform replacement for the inline shell upgrade command.
 * Adds the upstream remote if missing, fetches, then checks out scripts/.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(REPO_DIR, "package.json"), "utf8"));
const REPO_URL = pkg.repository?.url || "https://github.com/a-tokyo/aiworkspace.git";

function git(...args) {
  return execFileSync("git", args, { cwd: REPO_DIR, stdio: "pipe", encoding: "utf8" });
}

try {
  try {
    git("remote", "get-url", "upstream");
  } catch {
    git("remote", "add", "upstream", REPO_URL);
  }

  execFileSync("git", ["fetch", "upstream"], { cwd: REPO_DIR, stdio: "inherit" });
  execFileSync("git", ["checkout", "upstream/main", "--", "scripts/"], { cwd: REPO_DIR, stdio: "inherit" });
  console.log("Scripts updated. Review with: git diff --cached");
} catch (err) {
  console.error(`Upgrade failed: ${err.message}`);
  process.exit(1);
}
