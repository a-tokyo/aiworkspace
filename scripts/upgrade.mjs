#!/usr/bin/env node

/**
 * upgrade.mjs — Update scripts from the published aiworkspace package (npm) or git upstream.
 *
 * Primary: npm update aiworkspace, then copy node_modules/aiworkspace/scripts/ → scripts/
 * Fallback: git fetch upstream + checkout scripts/ (older workspaces without devDependency)
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync } from "node:fs";

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(REPO_DIR, "package.json"), "utf8"));
const DEFAULT_UPSTREAM = "https://github.com/a-tokyo/aiworkspace.git";

function repoUrl() {
  const u = pkg.repository?.url;
  if (!u) return DEFAULT_UPSTREAM;
  return u.replace(/^git\+/, "").replace(/\.git$/, "") + ".git";
}

function hasAiworkspaceDep() {
  return !!(pkg.devDependencies?.aiworkspace || pkg.dependencies?.aiworkspace);
}

function upgradeFromNpm() {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, ["update", "aiworkspace"], {
    cwd: REPO_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0 && result.status !== null) return false;

  const src = join(REPO_DIR, "node_modules", "aiworkspace", "scripts");
  if (!existsSync(src)) return false;

  const dest = join(REPO_DIR, "scripts");
  cpSync(src, dest, { recursive: true });

  const depPkgPath = join(REPO_DIR, "node_modules", "aiworkspace", "package.json");
  let ver = "?";
  try {
    ver = JSON.parse(readFileSync(depPkgPath, "utf8")).version;
  } catch { /* ignore */ }
  console.log(`Scripts updated from aiworkspace v${ver} (npm).`);
  return true;
}

function upgradeFromGit() {
  const REPO_URL = repoUrl();

  function git(...args) {
    return execFileSync("git", args, { cwd: REPO_DIR, stdio: "pipe", encoding: "utf8" });
  }

  try {
    git("remote", "get-url", "upstream");
  } catch {
    git("remote", "add", "upstream", REPO_URL);
  }

  execFileSync("git", ["fetch", "upstream"], { cwd: REPO_DIR, stdio: "inherit" });
  execFileSync("git", ["checkout", "upstream/main", "--", "scripts/"], { cwd: REPO_DIR, stdio: "inherit" });
  let ver = "?";
  try {
    const raw = git("show", "upstream/main:package.json");
    ver = JSON.parse(raw).version;
  } catch { /* ignore */ }
  console.log(`Scripts updated from aiworkspace v${ver} (git upstream). Review with: git diff --cached`);
}

try {
  if (hasAiworkspaceDep()) {
    if (!upgradeFromNpm()) {
      console.warn("npm update aiworkspace failed or package missing — trying git upstream fallback...");
      upgradeFromGit();
    }
  } else {
    console.log("No aiworkspace in package.json dependencies — using git upstream.");
    upgradeFromGit();
  }
} catch (err) {
  console.error(`Upgrade failed: ${err.message}`);
  process.exit(1);
}
