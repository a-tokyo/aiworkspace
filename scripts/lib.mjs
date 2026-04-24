/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * Shared utilities for workspace scripts.
 */

import {
  existsSync, lstatSync, statSync, readdirSync, readlinkSync, symlinkSync,
  unlinkSync, mkdirSync, copyFileSync, cpSync, rmSync,
  readFileSync, writeFileSync,
} from "node:fs";
import { join, resolve, relative, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { platform } from "node:os";

// ── Paths ───────────────────────────────────────────────────────────────

export const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WORKSPACE = resolve(REPO_DIR, "..");
export const ROOT_CONFIG = join(REPO_DIR, "root-config");
export const CANONICAL_SKILLS = join(ROOT_CONFIG, ".agents", "skills");

export const SYMLINK_TYPE = platform() === "win32" ? "junction" : undefined;

// Files in root-config/ that should NOT be mirrored to the parent root.
export const MIRROR_SKIP = new Set(["README.md", "skills-lock.json"]);

// Agent tool directories that get per-skill symlinks at the workspace root.
// Each entry is relative to WORKSPACE. The setup script creates
// <dir>/<skill-name> → canonical skill path.
export const SKILL_LINK_DIRS = [
  join(".claude", "skills"),
  "skills",
];

// Per-project subdirectories that get skill symlinks.
// relPrefix is relative from the subdir to the project's .agents/skills/.
export const PROJECT_SKILL_SUBDIRS = [
  { subdir: join(".claude", "skills"), relPrefix: join("..", "..", ".agents", "skills") },
];

// ── FS helpers ──────────────────────────────────────────────────────────

export function isSymlink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

export function isRealDir(p) {
  try { const s = lstatSync(p); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; }
}

export function isFile(p) {
  try { const s = lstatSync(p); return s.isFile() && !s.isSymbolicLink(); } catch { return false; }
}

export function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function removeIfEmpty(dir) {
  try {
    if (readdirSync(dir).filter(n => n !== ".DS_Store").length === 0) {
      rmSync(dir, { recursive: true });
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Create a symlink. If a correct symlink already exists, no-op.
 * Falls back to copy on Windows without Developer Mode.
 * Returns true on success.
 */
export function safeSymlink(target, linkPath, { quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const rel = relative(WORKSPACE, linkPath);

  if (isSymlink(linkPath)) {
    const existing = readlinkSync(linkPath);
    const linkDir = dirname(resolve(linkPath));
    if (existing === target || resolve(linkDir, existing) === resolve(linkDir, target)) {
      log(`  ✓ ${rel} (exists)`);
      return true;
    }
    unlinkSync(linkPath);
  } else if (existsSync(linkPath)) {
    console.warn(`  ⚠ ${rel} exists as real file/dir — skipping`);
    return false;
  }

  ensureDir(dirname(resolve(linkPath)));

  try {
    symlinkSync(target, linkPath, SYMLINK_TYPE);
    log(`  ✓ ${rel} → ${target}`);
    return true;
  } catch {
    const absTarget = resolve(dirname(resolve(linkPath)), target);
    try {
      if (lstatSync(absTarget).isDirectory()) {
        cpSync(absTarget, linkPath, { recursive: true });
      } else {
        copyFileSync(absTarget, linkPath);
      }
      console.warn(`  ⚠ Symlink failed for ${rel} — copied instead`);
      return true;
    } catch {
      console.error(`  ✗ Could not symlink or copy ${rel}`);
      return false;
    }
  }
}

// ── Git ─────────────────────────────────────────────────────────────────

/**
 * Returns the set of immediate child names under `dir` that are tracked or
 * untracked-but-not-ignored by git. Returns null if git is unavailable.
 */
export function gitTrackedChildren(dir) {
  try {
    const relDir = relative(REPO_DIR, dir).split("\\").join("/");
    const prefix = relDir ? `${relDir}/` : "";
    const stdout = execFileSync(
      "git", ["ls-files", "--cached", "--others", "--exclude-standard", prefix],
      { cwd: REPO_DIR, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
    );
    const names = new Set();
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      const rel = line.slice(prefix.length);
      const slash = rel.indexOf("/");
      names.add(slash === -1 ? rel : rel.slice(0, slash));
    }
    return names;
  } catch {
    return null;
  }
}

// ── URL normalization ────────────────────────────────────────────────────

/**
 * Normalize a GitHub or skills.sh URL to { source, skill? }.
 *
 * Supported inputs:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/blob/main/skills/name/SKILL.md
 *   https://skills.sh/owner/repo/skill-name
 *   owner/repo  (no-op passthrough)
 *
 * Returns null if the URL doesn't match any known pattern.
 */
export function normalizeGitHubUrl(url) {
  // skills.sh URL → owner/repo + optional skill name
  const skillsSh = url.match(/skills\.sh\/([^/]+)\/([^/]+)(?:\/([^/?#]+))?/);
  if (skillsSh) {
    const source = `${skillsSh[1]}/${skillsSh[2]}`;
    return { source, skill: skillsSh[3] || null };
  }

  // Any github.com URL → owner/repo
  const gh = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (gh) {
    return { source: `${gh[1]}/${gh[2].replace(/\.git$/, "")}`, skill: null };
  }

  return null;
}

// ── Skills ──────────────────────────────────────────────────────────────

export function getSkillNames(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir).filter(n => {
    if (n.startsWith(".")) return false;
    const full = join(skillsDir, n);
    return isRealDir(full) || isSymlink(full);
  });
}

export function resolveSkillsBin() {
  const base = resolve(REPO_DIR, "node_modules", ".bin", "skills");
  return process.platform === "win32" ? `${base}.cmd` : base;
}

/**
 * Remove symlinks the skills CLI creates inside a directory for each tool
 * (.cursor/skills/, .claude/skills/, and bare skills/ for OpenClaw).
 * We manage these ourselves via setup-skills.
 */
export function cleanCliArtifacts(dir) {
  for (const sub of [join(".cursor", "skills"), join(".claude", "skills"), "skills"]) {
    const skillsDir = join(dir, sub);
    if (!existsSync(skillsDir)) continue;
    for (const name of readdirSync(skillsDir)) {
      const p = join(skillsDir, name);
      try { if (lstatSync(p).isSymbolicLink()) unlinkSync(p); } catch { /* ignore */ }
    }
    try {
      if (readdirSync(skillsDir).filter(n => n !== ".DS_Store").length === 0) rmSync(skillsDir, { recursive: true });
      const parent = dirname(skillsDir);
      if (parent !== dir && existsSync(parent) && readdirSync(parent).filter(n => n !== ".DS_Store").length === 0) rmSync(parent, { recursive: true });
    } catch { /* ignore */ }
  }
}

/**
 * Remove a skill entry from skills-lock.json in the given directory.
 * The skills CLI doesn't clean up lock entries on remove.
 */
export function cleanLockEntry(dir, skillName) {
  if (!skillName) return;
  const lockPath = join(dir, "skills-lock.json");
  if (!existsSync(lockPath)) return;
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    if (lock.skills && lock.skills[skillName]) {
      delete lock.skills[skillName];
      writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
    }
  } catch { /* ignore malformed lock files */ }
}

/**
 * Validate that a skills-lock.json matches the actual skills on disk.
 * Returns { ok, extra, missing, isSymlink } where:
 *   extra     = entries in lock but no directory on disk
 *   missing   = directories on disk with no lock entry (locally-created skills are OK)
 *   isSymlink = true if the lock file is a symlink (dangerous — causes cross-contamination)
 */
export function validateLockFile(dir) {
  const lockPath = join(dir, "skills-lock.json");
  const skillsDir = join(dir, ".agents", "skills");
  const result = { ok: true, extra: [], missing: [], isSymlink: false, lockPath };

  if (existsSync(lockPath) && isSymlink(lockPath)) {
    result.isSymlink = true;
    result.ok = false;
  }

  let lockSkills = {};
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      lockSkills = lock.skills || {};
    } catch { /* malformed */ }
  }

  const diskSkills = getSkillNames(skillsDir);
  const lockNames = new Set(Object.keys(lockSkills));
  const diskNames = new Set(diskSkills);

  for (const name of lockNames) {
    if (!diskNames.has(name)) result.extra.push(name);
  }
  for (const name of diskNames) {
    if (!lockNames.has(name)) result.missing.push(name);
  }

  if (result.extra.length > 0) result.ok = false;
  return result;
}

// ── Project resolution ──────────────────────────────────────────────────

/**
 * Validate and resolve a --project argument. Returns the absolute path
 * to the project directory. Supports subdirectory paths (e.g. "website/backend").
 * Exits on invalid input.
 */
export function resolveProject(name) {
  if (!name) return null;
  // Normalize separators and split into segments
  const segments = name.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length === 0 || segments.some(s => s === "." || s === "..")) {
    console.error("Error: --project must not contain '.' or '..' path segments.");
    process.exit(1);
  }
  const dir = resolve(WORKSPACE, ...segments);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`Project not found: ${name}`);
    process.exit(1);
  }
  const real = resolve(dir);
  const realWs = resolve(WORKSPACE);
  const rel = relative(realWs, real);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    console.error("Error: --project must refer to a directory within the workspace.");
    process.exit(1);
  }
  return real;
}

/**
 * Extract --project <name> from args array (mutates args). Returns the name or null.
 */
export function extractProjectArg(args) {
  const idx = args.indexOf("--project");
  if (idx === -1) return null;
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) {
    console.error("Error: --project requires a project directory name.");
    process.exit(1);
  }
  args.splice(idx, 2);
  return value;
}

/**
 * Extract --no-setup from args array (mutates args). Returns boolean.
 */
export function extractNoSetupArg(args) {
  const idx = args.indexOf("--no-setup");
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

/**
 * Run setup-skills.mjs. Exits on failure.
 */
export function runSetup() {
  const script = join(REPO_DIR, "scripts", "skills", "setup-skills.mjs");
  const result = spawnSync("node", [script], { cwd: REPO_DIR, stdio: "inherit" });
  if (result.error) { console.error(`Setup failed: ${result.error.message}`); process.exit(1); }
  if (result.signal) { console.error(`Setup killed by ${result.signal}`); process.exit(1); }
  if (result.status) process.exit(result.status);
}

/**
 * Run the skills CLI with given subcommand and args. Exits on failure.
 */
export function runSkillsCli(subcommand, args, { cwd = REPO_DIR } = {}) {
  const result = spawnSync(resolveSkillsBin(), [subcommand, ...args], {
    cwd,
    stdio: "inherit",
    ...(process.platform === "win32" ? { shell: true } : {}),
  });
  if (result.error) { console.error(`Failed to run skills CLI: ${result.error.message}`); process.exit(1); }
  if (result.signal) { console.error(`Skills CLI killed by ${result.signal}`); process.exit(1); }
  if (result.status) process.exit(result.status);
}

