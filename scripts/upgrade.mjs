#!/usr/bin/env node

/**
 * upgrade.mjs — Update scripts from the aiworkspace npm package or git upstream.
 *
 * If aiworkspace is in devDependencies: npm update + copy scripts/ from the package.
 * Otherwise: git fetch upstream + checkout scripts/ (backwards-compatible fallback).
 *
 * After scripts update: scaffold/merge MCP configs and re-sync parent-root symlinks.
 */

import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

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
 * Resolve the aiworkspace package's `scripts` block for the active upgrade path.
 * npm/local paths read node_modules/aiworkspace; the git fallback reads upstream.
 */
function readTemplateScripts({ ephemeralTemplate, repoDir }) {
  if (ephemeralTemplate) {
    try {
      const content = execFileSync(
        "git", ["show", "upstream/main:package.json"],
        { cwd: repoDir, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
      );
      return JSON.parse(content).scripts ?? {};
    } catch { return {}; }
  }
  const pkgPath = join(repoDir, "node_modules", "aiworkspace", "package.json");
  try { return JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {}; } catch { return {}; }
}

/**
 * Add missing template scripts (e.g. mcp:check-secrets) to the consumer
 * package.json without overwriting existing scripts. Returns changed git paths.
 */
function mergeConsumerPackageScripts({ templateScripts, repoDir, mergePackageScripts }) {
  const pkgPath = join(repoDir, "package.json");
  if (!existsSync(pkgPath)) return { changedPaths: [] };
  let consumer;
  try { consumer = JSON.parse(readFileSync(pkgPath, "utf8")); } catch { return { changedPaths: [] }; }
  const { scripts, added } = mergePackageScripts(consumer.scripts ?? {}, templateScripts);
  if (added.length === 0) return { changedPaths: [] };
  consumer.scripts = scripts;
  writeFileSync(pkgPath, JSON.stringify(consumer, null, 2) + "\n");
  for (const name of added) console.log(`  + package.json script: ${name}`);
  return { changedPaths: ["package.json"] };
}

function stageGit(paths) {
  if (!existsSync(join(REPO_DIR, ".git")) || paths.length === 0) return false;
  try {
    execFileSync("git", ["add", ...paths], { cwd: REPO_DIR, stdio: "ignore" });
    return true;
  } catch {
    console.warn("⚠ Could not stage upgrade changes (git add failed).");
    return false;
  }
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

function upgradeViaLocalPackage() {
  const pkgRoot = join(REPO_DIR, "node_modules", "aiworkspace");
  const src = join(pkgRoot, "scripts");
  if (!existsSync(src)) return null;

  replaceScriptsFromPackage(src, join(REPO_DIR, "scripts"));

  const ver = readVersion(join(pkgRoot, "package.json"));
  console.log(`Scripts updated from aiworkspace v${ver} (node_modules fallback).`);

  return join(pkgRoot, "root-config");
}

function upgradeViaNpm() {
  const r = spawnSync("npm", ["update", "aiworkspace"], {
    cwd: REPO_DIR, stdio: "inherit", shell: process.platform === "win32",
  });
  if (r.signal) {
    throw new Error(`npm update was interrupted (signal: ${r.signal}).`);
  }
  if (r.error || r.status !== 0) return null;

  const src = join(REPO_DIR, "node_modules", "aiworkspace", "scripts");
  if (!existsSync(src)) {
    console.warn("npm update succeeded but node_modules/aiworkspace/scripts/ is missing.");
    return null;
  }

  replaceScriptsFromPackage(src, join(REPO_DIR, "scripts"));

  const ver = readVersion(join(REPO_DIR, "node_modules", "aiworkspace", "package.json"));
  console.log(`Scripts updated from aiworkspace v${ver} (npm).`);

  return join(REPO_DIR, "node_modules", "aiworkspace", "root-config");
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
  console.log(`Scripts updated from aiworkspace v${ver} (git upstream).`);
}

let templateRoot = null;
let ephemeralTemplate = false;

try {
  const hasNpmDep = pkg.devDependencies?.aiworkspace || pkg.dependencies?.aiworkspace;

  if (hasNpmDep) {
    templateRoot = upgradeViaNpm();
    if (!templateRoot) {
      templateRoot = upgradeViaLocalPackage();
    }
    if (!templateRoot) {
      console.warn("npm upgrade failed — falling back to git upstream...");
      upgradeViaGit();
      ephemeralTemplate = true;
    }
  } else {
    upgradeViaGit();
    ephemeralTemplate = true;
  }

  const scriptsLibUrl = `${pathToFileURL(join(REPO_DIR, "scripts", "lib.mjs")).href}?v=${Date.now()}`;
  const upgradeMcpUrl = `${pathToFileURL(join(REPO_DIR, "scripts", "upgrade-mcp.mjs")).href}?v=${Date.now()}`;
  const { runSetup, mergePackageScripts } = await import(scriptsLibUrl);
  const { upgradeMcp, upgradeEnvScaffold, materializeGitTemplateRoot } = await import(upgradeMcpUrl);

  if (ephemeralTemplate) {
    templateRoot = materializeGitTemplateRoot();
  }

  const templateScripts = readTemplateScripts({ ephemeralTemplate, repoDir: REPO_DIR });
  const { changedPaths: pkgPaths } = mergeConsumerPackageScripts({
    templateScripts, repoDir: REPO_DIR, mergePackageScripts,
  });
  const { changedPaths: envPaths } = upgradeEnvScaffold({ templateRoot });
  const { changedPaths: mcpPaths } = upgradeMcp({ templateRoot });
  runSetup({ ensure: true });

  const toStage = ["scripts/"];
  if (existsSync(join(REPO_DIR, "package-lock.json"))) toStage.push("package-lock.json");
  toStage.push("package.json", ...pkgPaths, ...envPaths, ...mcpPaths);
  if (stageGit(toStage)) {
    console.log("Staged upgrade changes — review with: git diff --cached");
  }
} catch (err) {
  console.error(`Upgrade failed: ${err.message}`);
  process.exit(1);
} finally {
  if (ephemeralTemplate && templateRoot) {
    rmSync(templateRoot, { recursive: true, force: true });
  }
}
