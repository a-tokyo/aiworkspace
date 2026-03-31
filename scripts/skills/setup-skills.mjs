#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * setup-skills.mjs
 *
 * Mirrors workspace/root-config/ to the parent root and creates per-skill
 * symlinks for each AI tool. The mirror is generic — adding new configs to
 * root-config/ requires no script changes.
 *
 * Mirror rules (two-level walk of root-config/):
 *   L1 files  → copy to parent root
 *   L1 dirs   → create real dir at parent root, symlink each L2 item
 *
 * Per-skill symlinks:
 *   .cursor/skills/{name} → canonical  (Cursor)
 *   .claude/skills/{name} → canonical  (Claude Code)
 *   skills/{name}         → canonical  (OpenClaw)
 *
 * Usage:
 *   node scripts/skills/setup-skills.mjs          # full setup
 *   node scripts/skills/setup-skills.mjs --ensure  # quick idempotent check
 *   node scripts/skills/setup-skills.mjs --clean   # remove all synced items
 */

import { existsSync, readdirSync, readFileSync, readlinkSync, copyFileSync, unlinkSync, rmSync } from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import {
  REPO_DIR, WORKSPACE, ROOT_CONFIG, CANONICAL_SKILLS,
  MIRROR_SKIP, SKILL_LINK_DIRS, PROJECT_SKILL_SUBDIRS,
  isSymlink, isRealDir, isFile, ensureDir, removeIfEmpty,
  safeSymlink, gitTrackedChildren, getSkillNames, cleanCliArtifacts,
  validateLockFile,
} from "../lib.mjs";

const args = process.argv.slice(2);
const isEnsure = args.includes("--ensure");
const isClean = args.includes("--clean");

function log(msg) { if (!isEnsure) console.log(msg); }

// ── Mirror root-config → parent root ────────────────────────────────────

function mirrorRootConfig() {
  if (!existsSync(ROOT_CONFIG)) { log("  ⚠ No root-config/ directory found"); return; }

  const tracked = gitTrackedChildren(ROOT_CONFIG);

  for (const entry of readdirSync(ROOT_CONFIG, { withFileTypes: true })) {
    if (MIRROR_SKIP.has(entry.name)) continue;
    if (tracked && !tracked.has(entry.name)) continue;

    const src = join(ROOT_CONFIG, entry.name);
    const dest = join(WORKSPACE, entry.name);

    if (entry.isFile()) {
      syncFile(src, dest, entry.name);
    } else if (entry.isDirectory()) {
      if (isSymlink(dest)) { unlinkSync(dest); log(`  ✗ Replaced old symlink ${entry.name}/`); }
      ensureDir(dest);
      mirrorL2(src, dest);
    }
  }
}

function syncFile(src, dest, name) {
  const content = readFileSync(src, "utf8");
  if (existsSync(dest) && isFile(dest) && readFileSync(dest, "utf8") === content) {
    log(`  ✓ ${name} (up to date)`);
    return;
  }
  copyFileSync(src, dest);
  log(`  ✓ ${name} → root (synced)`);
}

function mirrorL2(srcDir, destDir) {
  const tracked = gitTrackedChildren(srcDir);

  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (tracked && !tracked.has(entry.name)) continue;

    const destItem = join(destDir, entry.name);
    const relTarget = relative(destDir, join(srcDir, entry.name));

    if (isSymlink(destItem)) {
      const existing = readlinkSync(destItem);
      if (existing === relTarget || resolve(destDir, existing) === resolve(destDir, relTarget)) {
        log(`  ✓ ${relative(WORKSPACE, destItem)} (exists)`);
        continue;
      }
      unlinkSync(destItem);
    } else if (existsSync(destItem)) {
      if (isRealDir(destItem)) {
        console.warn(`  ⚠ ${relative(WORKSPACE, destItem)} exists — resolve manually or remove it`);
        continue;
      }
      unlinkSync(destItem);
    }

    safeSymlink(relTarget, destItem, { quiet: isEnsure });
  }
}

// ── Per-skill symlinks ──────────────────────────────────────────────────

function cleanStaleLinks(dir, validNames) {
  if (!existsSync(dir)) return;
  const valid = new Set(validNames);
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (isSymlink(p) && !valid.has(name)) {
      unlinkSync(p);
      log(`  ✗ Removed stale ${relative(WORKSPACE, p)}`);
    }
  }
}

function linkWorkspaceSkills(projects) {
  const names = getSkillNames(CANONICAL_SKILLS);
  let count = 0;
  let locations = 0;

  for (const sub of SKILL_LINK_DIRS) {
    const dir = join(WORKSPACE, sub);
    cleanStaleLinks(dir, names);
    if (names.length === 0) continue;
    ensureDir(dir);
    const prefix = relative(dir, CANONICAL_SKILLS);
    for (const name of names) safeSymlink(join(prefix, name), join(dir, name), { quiet: isEnsure });
    locations++;
  }
  count += names.length;

  for (const proj of projects) {
    const skills = getSkillNames(proj.skillsDir);
    for (const { subdir, relPrefix } of PROJECT_SKILL_SUBDIRS) {
      const dir = join(proj.dir, subdir);
      cleanStaleLinks(dir, skills);
      if (skills.length > 0) {
        ensureDir(dir);
        for (const name of skills) safeSymlink(join(relPrefix, name), join(dir, name), { quiet: isEnsure });
        locations++;
      } else {
        removeIfEmpty(dir);
        const parent = dirname(dir);
        if (parent !== proj.dir) removeIfEmpty(parent);
      }
    }
    if (skills.length) {
      log(`\n  Project skills (${proj.name}/.agents/skills/): ${skills.length}`);
      count += skills.length;
    }
  }

  return { count, locations };
}

function getProjectsWithSkills() {
  const projects = [];
  for (const name of readdirSync(WORKSPACE)) {
    if (name.startsWith(".") || name === "skills" || name === "node_modules") continue;
    const dir = join(WORKSPACE, name);
    const skillsDir = join(dir, ".agents", "skills");
    if (isRealDir(dir) && isRealDir(skillsDir)) {
      projects.push({ name, dir, skillsDir });
    }
  }
  return projects;
}

// ── Clean mode ──────────────────────────────────────────────────────────

function clean() {
  console.log("\n🧹 Cleaning synced files and symlinks...\n");

  if (existsSync(ROOT_CONFIG)) {
    const tracked = gitTrackedChildren(ROOT_CONFIG);
    for (const entry of readdirSync(ROOT_CONFIG, { withFileTypes: true })) {
      if (MIRROR_SKIP.has(entry.name)) continue;
      if (tracked && !tracked.has(entry.name)) continue;
      cleanMirroredEntry(entry);
    }
  }

  cleanOrphanDirs();
  cleanSkillLinks();
  cleanProjectSkillLinks();

  console.log("\n✅ Clean complete. Run without --clean to re-create.\n");
}

function cleanMirroredEntry(entry) {
  const dest = join(WORKSPACE, entry.name);
  if (!existsSync(dest)) return;

  if (entry.isFile()) {
    if (!isFile(dest)) return;
    const src = readFileSync(join(ROOT_CONFIG, entry.name), "utf8");
    if (src === readFileSync(dest, "utf8")) {
      unlinkSync(dest);
      console.log(`  ✗ Removed ${entry.name}`);
    } else {
      console.log(`  ⚠ ${entry.name} has local edits — skipping`);
    }
    return;
  }

  if (isSymlink(dest)) { unlinkSync(dest); console.log(`  ✗ Removed ${entry.name}/`); return; }

  if (isRealDir(dest)) {
    for (const l2 of readdirSync(dest)) {
      const p = join(dest, l2);
      if (isSymlink(p)) { unlinkSync(p); console.log(`  ✗ Removed ${relative(WORKSPACE, p)}`); }
    }
    removeIfEmpty(dest);
  }
}

function cleanOrphanDirs() {
  for (const name of readdirSync(WORKSPACE)) {
    if (!name.startsWith(".")) continue;
    const dest = join(WORKSPACE, name);
    if (!isRealDir(dest) || existsSync(join(ROOT_CONFIG, name))) continue;

    let cleaned = false;
    for (const l2 of readdirSync(dest)) {
      const p = join(dest, l2);
      if (!isSymlink(p)) continue;
      if (resolve(dest, readlinkSync(p)).startsWith(ROOT_CONFIG + sep)) {
        unlinkSync(p);
        console.log(`  ✗ Removed orphan ${relative(WORKSPACE, p)}`);
        cleaned = true;
      }
    }
    if (cleaned) removeIfEmpty(dest);
  }
}

function cleanSkillLinks() {
  for (const sub of SKILL_LINK_DIRS) {
    const dir = join(WORKSPACE, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (isSymlink(p)) { unlinkSync(p); console.log(`  ✗ Removed ${relative(WORKSPACE, p)}`); }
    }
    removeEmptyParents(dir);
  }
}

function cleanProjectSkillLinks() {
  for (const name of readdirSync(WORKSPACE)) {
    if (name.startsWith(".") || name === "skills" || name === "node_modules") continue;
    for (const { subdir } of PROJECT_SKILL_SUBDIRS) {
      const dir = join(WORKSPACE, name, subdir);
      if (!existsSync(dir)) continue;
      for (const sname of readdirSync(dir)) {
        const p = join(dir, sname);
        if (isSymlink(p)) { unlinkSync(p); console.log(`  ✗ Removed ${relative(WORKSPACE, p)}`); }
      }
      removeEmptyParents(dir);
    }
  }
}

function removeEmptyParents(dir) {
  try {
    if (readdirSync(dir).filter(n => n !== ".DS_Store").length === 0) {
      rmSync(dir, { recursive: true });
      const parent = dirname(dir);
      if (parent !== WORKSPACE && existsSync(parent) && readdirSync(parent).filter(n => n !== ".DS_Store").length === 0) {
        rmSync(parent, { recursive: true });
      }
    }
  } catch { /* ignore */ }
}

// ── Setup mode ──────────────────────────────────────────────────────────

function setup() {
  if (!isEnsure) console.log("\n🔗 Setting up AI agent environment...\n");

  cleanCliArtifacts(REPO_DIR);
  mirrorRootConfig();

  const projects = getProjectsWithSkills();
  const { count, locations } = linkWorkspaceSkills(projects);

  if (!isEnsure) console.log(`\n✅ ${count} skill(s) linked across ${locations} location(s).\n`);

  warnLockMismatches();
}

// ── Lock file validation ─────────────────────────────────────────────────

function warnLockMismatches() {
  for (const dir of [REPO_DIR, ROOT_CONFIG]) {
    const result = validateLockFile(dir);
    const rel = relative(REPO_DIR, result.lockPath);
    if (result.isSymlink) {
      console.warn(`\n⚠ ${rel} is a symlink — this causes cross-contamination.`);
      console.warn(`  Fix: delete ${rel}, then run: npx skills update`);
    }
    if (result.extra.length > 0) {
      console.warn(`\n⚠ ${rel} has entries with no matching skill directory:`);
      for (const name of result.extra) console.warn(`    ${name}`);
      console.warn(`  Run: npm run skills:check`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────

if (isClean) clean(); else setup();
