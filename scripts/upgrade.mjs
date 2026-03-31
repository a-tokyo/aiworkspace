#!/usr/bin/env node

/**
 * upgrade.mjs — Update scripts from the aiworkspace npm package or git upstream.
 *
 * If aiworkspace is in devDependencies: npm update + copy scripts/ from the package.
 * Otherwise: git fetch upstream + checkout scripts/ (backwards-compatible fallback).
 */

import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8"));
const DEFAULT_UPSTREAM = (() => {
  try {
    const ai = JSON.parse(
      readFileSync(join(REPO_DIR, "node_modules", "aiworkspace", "package.json"), "utf8"),
    );
    const url = ai.repository?.url;
    if (url) return url.replace(/^git\+/, "");
  } catch { /* not installed — use hardcoded fallback */ }
  return "https://github.com/a-tokyo/aiworkspace.git";
})();

function readVersion(path) {
  try { return JSON.parse(readFileSync(path, "utf8")).version; } catch { return "?"; }
}

/**
 * Copy package scripts into a temp dir, then swap into dest so we never leave
 * scripts/ missing if the copy step fails. On swap failure, restore the prior
 * scripts/ from backup when possible.
 */
function replaceScriptsFromPackage(src, dest) {
  const tmp = `${dest}.upgrade-tmp`;
  const backup = `${dest}.upgrade-backup`;

  rmSync(tmp, { recursive: true, force: true });

  if (existsSync(backup)) {
    if (!existsSync(dest)) {
      renameSync(backup, dest);
    } else {
      throw new Error(
        `${basename(backup)} and scripts/ both exist. Remove or merge the backup, then retry.`,
      );
    }
  }

  cpSync(src, tmp, { recursive: true });

  if (existsSync(dest)) {
    renameSync(dest, backup);
  }

  try {
    renameSync(tmp, dest);
    rmSync(backup, { recursive: true, force: true });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    if (existsSync(backup)) {
      try { renameSync(backup, dest); } catch { /* leave backup for manual recovery */ }
    }
    throw err;
  }
}

function upgradeViaNpm() {
  const r = spawnSync("npm", ["update", "aiworkspace"], {
    cwd: REPO_DIR, stdio: "inherit", shell: process.platform === "win32",
  });
  if (r.signal) {
    throw new Error(`npm update was interrupted (signal: ${r.signal}).`);
  }
  if (r.error || r.status !== 0) return false;

  const src = join(REPO_DIR, "node_modules", "aiworkspace", "scripts");
  if (!existsSync(src)) {
    console.warn("npm update succeeded but node_modules/aiworkspace/scripts/ is missing.");
    return false;
  }

  replaceScriptsFromPackage(src, join(REPO_DIR, "scripts"));

  const isGit = existsSync(join(REPO_DIR, ".git"));
  if (isGit) {
    const toStage = ["scripts/", "package.json"];
    if (existsSync(join(REPO_DIR, "package-lock.json"))) toStage.push("package-lock.json");
    try { execFileSync("git", ["add", ...toStage], { cwd: REPO_DIR, stdio: "ignore" }); } catch { /* ignore */ }
  }
  const ver = readVersion(join(REPO_DIR, "node_modules", "aiworkspace", "package.json"));
  const hint = isGit ? " Review with: git diff --cached" : "";
  console.log(`Scripts updated from aiworkspace v${ver} (npm).${hint}`);
  return true;
}

function upgradeViaGit() {
  function git(...args) {
    return execFileSync("git", args, { cwd: REPO_DIR, stdio: "pipe", encoding: "utf8" });
  }

  try { git("remote", "get-url", "upstream"); } catch {
    git("remote", "add", "upstream", DEFAULT_UPSTREAM);
  }

  execFileSync("git", ["fetch", "upstream"], { cwd: REPO_DIR, stdio: "inherit" });
  execFileSync("git", ["checkout", "upstream/main", "--", "scripts/"], { cwd: REPO_DIR, stdio: "inherit" });
  let ver = "?";
  try { ver = JSON.parse(git("show", "upstream/main:package.json")).version; } catch { /* ignore */ }
  console.log(`Scripts updated from aiworkspace v${ver} (git upstream). Review with: git diff --cached`);
}

try {
  const hasNpmDep = pkg.devDependencies?.aiworkspace || pkg.dependencies?.aiworkspace;
  if (hasNpmDep) {
    if (!upgradeViaNpm()) {
      console.warn("npm upgrade failed — falling back to git upstream...");
      upgradeViaGit();
    }
  } else {
    upgradeViaGit();
  }
} catch (err) {
  console.error(`Upgrade failed: ${err.message}`);
  process.exit(1);
}
