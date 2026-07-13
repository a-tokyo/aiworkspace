/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * Shared utilities for workspace scripts.
 */

import {
  existsSync, lstatSync, statSync, readdirSync, readlinkSync, symlinkSync,
  unlinkSync, mkdirSync, copyFileSync, cpSync, rmSync,
  readFileSync, writeFileSync, realpathSync,
} from "node:fs";
import { join, resolve, relative, dirname, isAbsolute, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { platform } from "node:os";

// ── Paths ───────────────────────────────────────────────────────────────

export const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WORKSPACE = resolve(REPO_DIR, "..");
export const ROOT_CONFIG = join(REPO_DIR, "root-config");
export const CANONICAL_SKILLS = join(ROOT_CONFIG, ".agents", "skills");

export const SYMLINK_TYPE = platform() === "win32" ? "junction" : undefined;

/** Double-quoted path safe to paste into sh/bash/zsh (spaces, $, backticks). */
export function shellQuotedPath(filePath) {
  return `"${filePath
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")}"`;
}

/** Windows: `junction` for directories, `file` for files; undefined on Unix. */
export function symlinkTypeFor(target, linkPath) {
  if (platform() !== "win32") return undefined;
  try {
    const absTarget = resolve(dirname(resolve(linkPath)), target);
    return lstatSync(absTarget).isDirectory() ? "junction" : "file";
  } catch {
    return SYMLINK_TYPE;
  }
}

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
 * Create a symlink. If a correct symlink already exists, no-op (or no-op with
 * `replace: true`, which returns false to mean "unchanged").
 * Falls back to copy on Windows without Developer Mode when `copyFallback` is true.
 * Returns true when the link was created or already correct (replace: false);
 * false when skipped, unchanged (replace: true), or failed.
 */
export function safeSymlink(target, linkPath, { quiet = false, replace = false, copyFallback = true } = {}) {
  const log = quiet ? () => {} : console.log;
  const rel = relative(WORKSPACE, linkPath);
  let fileBackup = null;

  if (isSymlink(linkPath)) {
    const existing = readlinkSync(linkPath);
    const linkDir = dirname(resolve(linkPath));
    if (existing === target || resolve(linkDir, existing) === resolve(linkDir, target)) {
      if (replace) return false;
      log(`  ✓ ${rel} (exists)`);
      return true;
    }
    rmSync(linkPath, { force: true });
  } else if (existsSync(linkPath)) {
    if (replace && isFile(linkPath)) {
      console.warn(`  ⚠ ${rel} is a regular file — replacing with symlink`);
      fileBackup = readFileSync(linkPath);
      rmSync(linkPath, { force: true });
    } else if (replace && isRealDir(linkPath)) {
      console.warn(`  ⚠ ${rel} is a directory — skipping`);
      return false;
    } else {
      console.warn(`  ⚠ ${rel} exists as real file/dir — skipping`);
      return false;
    }
  }

  ensureDir(dirname(resolve(linkPath)));

  const restoreFileBackup = () => {
    if (fileBackup === null) return false;
    try {
      writeFileSync(linkPath, fileBackup);
      console.warn(`  ⚠ Restored ${rel} after symlink failure`);
      return true;
    } catch {
      console.error(`  ✗ Could not restore ${rel} after symlink failure`);
      return false;
    }
  };

  try {
    symlinkSync(target, linkPath, symlinkTypeFor(target, linkPath));
    log(`  ✓ ${rel} → ${target}`);
    return true;
  } catch {
    if (copyFallback) {
      const absTarget = resolve(dirname(resolve(linkPath)), target);
      try {
        if (lstatSync(absTarget).isDirectory()) {
          cpSync(absTarget, linkPath, { recursive: true });
        } else {
          copyFileSync(absTarget, linkPath);
        }
        console.warn(`  ⚠ Symlink failed for ${rel} — copied instead`);
        return true;
      } catch { /* fall through to restore */ }
    }
    restoreFileBackup();
    if (!copyFallback) {
      console.warn(`  ⚠ Could not create symlink at ${rel}`);
    } else {
      console.error(`  ✗ Could not symlink or copy ${rel}`);
    }
    return false;
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
 * Env overrides that make git/ssh/credential-manager fail fast instead of
 * prompting on /dev/tty. Interactive prompts read the controlling terminal
 * directly, which `stdio: "ignore"` does NOT redirect — so without these a
 * clone can block a `npm install` indefinitely waiting for input.
 */
export function nonInteractiveGitEnv(base = process.env) {
  return {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: base.GIT_SSH_COMMAND || "ssh -oBatchMode=yes",
    GCM_INTERACTIVE: "never",
  };
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
  const segments = name.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.length === 0) {
    console.error("Error: --project must not be empty.");
    process.exit(1);
  }
  if (segments.some(s => s === "." || s === "..")) {
    console.error("Error: --project must not contain '.' or '..' path segments.");
    process.exit(1);
  }
  const dir = resolve(WORKSPACE, ...segments);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`Project not found: ${name}`);
    process.exit(1);
  }
  let real;
  let realWs;
  try {
    real = realpathSync(dir);
    realWs = realpathSync(WORKSPACE);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Error: could not resolve real path for --project ${name} (${dir}): ${detail}`);
    process.exit(1);
  }
  const rel = relative(realWs, real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
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
export function runSetup({ ensure = false, repoDir = REPO_DIR } = {}) {
  const script = join(repoDir, "scripts", "skills", "setup-skills.mjs");
  const args = ensure ? ["--ensure"] : [];
  const result = spawnSync(process.execPath, [script, ...args], { cwd: repoDir, stdio: "inherit" });
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

// ── MCP config helpers ───────────────────────────────────────────────────

/**
 * Parse an MCP JSON file. Normalizes VS Code "servers" to mcpServers shape.
 * Returns null on missing/invalid file.
 */
export function readMcpJson(path) {
  try {
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw);
    const isValidObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    if (isValidObj(data.mcpServers)) return { mcpServers: data.mcpServers, schema: "mcpServers" };
    if (isValidObj(data.servers)) return { mcpServers: data.servers, schema: "servers" };
    return null;
  } catch {
    return null;
  }
}

/**
 * True when path is a readable MCP source for import (not a symlink into root-config).
 */
export function isImportableMcpFile(path, rootConfig = ROOT_CONFIG) {
  if (!existsSync(path)) return false;
  try {
    const st = lstatSync(path);
    if (st.isDirectory()) return false;
    if (st.isSymbolicLink()) {
      let resolved;
      try { resolved = realpathSync(path); } catch { resolved = resolve(dirname(path), readlinkSync(path)); }
      let rc = rootConfig;
      try { rc = realpathSync(rootConfig); } catch { /* ignore */ }
      const rcNorm = rc.endsWith(sep) ? rc.slice(0, -1) : rc;
      const inside = resolved === rcNorm || resolved === rc
        || (process.platform === "win32"
          ? resolved.toLowerCase().startsWith(`${rcNorm.toLowerCase()}${sep}`)
          : resolved.startsWith(`${rcNorm}${sep}`));
      if (inside) return false;
    }
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}

// MCP template paths relative to root-config/
export const MCP_TEMPLATE_REL_PATHS = [
  join(".agents", "mcp.json"),
  join(".codex", "config.toml"),
  join(".vscode", "mcp.json"),
];

// ── MCP placeholder / secret helpers ────────────────────────────────────

/**
 * Transport of an MCP server, inferred when `type` is absent.
 *
 * Claude Code and Cursor both accept a bare `{ command, args }` (no `type`), so
 * keying behaviour off `config.type` alone silently skips those servers — they
 * escape secret-wrapping and drop out of the Codex twin. Infer from shape.
 */
export function serverKind(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  if (typeof config.type === "string" && config.type) return config.type;
  if (config.command) return "stdio";
  if (config.url) return "http";
  return null;
}

export const MCP_PLACEHOLDER_RE = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function hasMcpPlaceholder(value) {
  if (typeof value !== "string") return false;
  return /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/.test(value);
}

const SINGLE_MCP_PLACEHOLDER_RE = /^\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** Env entries like API_KEY: "${MY_API_KEY}" need remapping when wrapping (child key ≠ source var). */
export function extractEnvKeyMaps(env) {
  if (!env || typeof env !== "object") return [];
  const maps = [];
  for (const [childKey, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    const m = value.match(SINGLE_MCP_PLACEHOLDER_RE);
    if (m && m[1] !== childKey) maps.push({ childKey, sourceVar: m[1] });
  }
  return maps;
}

export function collectMcpPlaceholders(value, vars = new Set()) {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g)) vars.add(m[1]);
    return vars;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectMcpPlaceholders(v, vars);
    return vars;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectMcpPlaceholders(v, vars);
  }
  return vars;
}

/** Relative path to mcp-load-env.mjs from parent workspace root (e.g. workspace/scripts/...). */
export function mcpLoadEnvRel(repoDir = REPO_DIR) {
  return join(basename(repoDir), "scripts", "mcp-load-env.mjs").replaceAll("\\", "/");
}

export function isMcpLoadEnvWrapped(config) {
  if (serverKind(config) !== "stdio") return false;
  const args = config.args ?? [];
  return config.command === "node"
    && args.some((a) => typeof a === "string" && a.includes("mcp-load-env.mjs"));
}

export function parseOnlyVarsFromWrappedArgs(args = []) {
  const idx = args.indexOf("--only");
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1].split(",").map((s) => s.trim()).filter(Boolean);
  }
  return null;
}

export function secretVarsForMcpServer(_name, config) {
  const vars = new Set();
  if (isMcpLoadEnvWrapped(config)) {
    const fromOnly = parseOnlyVarsFromWrappedArgs(config.args ?? []);
    if (fromOnly?.length) {
      for (const v of fromOnly) vars.add(v);
      return vars;
    }
  }
  collectMcpPlaceholders(config, vars);
  return vars;
}

/**
 * Vars referenced by an HTTP `Authorization: Bearer ...` header using `${env:VAR}` /
 * `${VAR}` placeholders. Cursor reads `${env:VAR}` from the process environment at
 * startup (not envFile — stdio only). VS Code twins get envFile on sync. Callers
 * surface setup hints (shell profile one-liner) rather than a plain missing-secret
 * warning. Returns an empty set for non-Bearer or non-HTTP servers.
 */
export function httpBearerVarsForMcpServer(config) {
  const vars = new Set();
  if (serverKind(config) !== "http") return vars;
  const auth = config.headers?.Authorization;
  if (typeof auth !== "string" || !/^Bearer\s/i.test(auth)) return vars;
  for (const m of auth.matchAll(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g)) vars.add(m[1]);
  return vars;
}

/** All Bearer header env vars across MCP servers (sorted array). */
export function collectHttpBearerVars(mcpServers) {
  const vars = new Set();
  if (!mcpServers || typeof mcpServers !== "object") return [];
  for (const config of Object.values(mcpServers)) {
    for (const v of httpBearerVarsForMcpServer(config)) vars.add(v);
  }
  return [...vars].sort();
}

/** Bearer keys from canonical mcp.json (empty when missing or invalid). */
export function readBearerKeysFromMcp() {
  const path = join(ROOT_CONFIG, ".agents", "mcp.json");
  if (!existsSync(path)) return [];
  const parsed = readMcpJson(path);
  if (!parsed) return [];
  return collectHttpBearerVars(parsed.mcpServers);
}

/** Bearer keys cached in scripts/.mcp-env.paths at install time. */
export function readBearerKeysFromPathsFile(pathsFile) {
  if (!existsSync(pathsFile)) return [];
  const content = readFileSync(pathsFile, "utf8");
  const match = content.match(/^BEARER_KEYS=(.+)$/m);
  if (!match) return [];
  return match[1].split(",").map((s) => s.trim()).filter(Boolean);
}

function pwshQuotedPath(filePath) {
  return `'${filePath.replace(/'/g, "''")}'`;
}

/** PowerShell 7+ profile path on Windows. */
export function defaultPwsh7Profile(home, userProfile = process.env.USERPROFILE) {
  const docs = userProfile ?? home;
  return join(docs, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
}

/** Windows PowerShell 5.1 profile path. */
export function defaultWindowsPowerShell51Profile(home, userProfile = process.env.USERPROFILE) {
  const docs = userProfile ?? home;
  return join(docs, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1");
}

/**
 * Pick the PowerShell profile path most likely to load on this machine.
 * On Windows without pwsh, fall back to Windows PowerShell 5.1.
 */
export function resolvePwshProfilePath(
  home,
  {
    platformName = platform(),
    isCliAvailableFn = isCliAvailable,
    existsSyncFn = existsSync,
    override = process.env.AIWORKSPACE_PWSH_PROFILE,
    userProfile = process.env.USERPROFILE,
  } = {},
) {
  if (override) return override;
  if (platformName === "win32") {
    const pwsh7 = defaultPwsh7Profile(home, userProfile);
    if (existsSyncFn(pwsh7) || isCliAvailableFn("pwsh")) return pwsh7;
    if (isCliAvailableFn("powershell")) return defaultWindowsPowerShell51Profile(home, userProfile);
    return pwsh7;
  }
  return join(home, ".config", "powershell", "Microsoft.PowerShell_profile.ps1");
}

export const MCP_ENV_MARKER_START = "# >>> aiworkspace-mcp-env >>>";
export const MCP_ENV_MARKER_END = "# <<< aiworkspace-mcp-env <<<";

export function buildMcpEnvMarkerBlock({ shell, envScriptPath }) {
  const scriptsDir = dirname(envScriptPath);
  if (shell === "pwsh") {
    const scriptQ = pwshQuotedPath(envScriptPath);
    return [
      MCP_ENV_MARKER_START,
      "# MCP Bearer tokens for Cursor. Managed by: npm run mcp:install-shell",
      `if (Test-Path -LiteralPath ${scriptQ}) { . ${scriptQ} }`,
      MCP_ENV_MARKER_END,
    ].join("\n");
  }
  const scriptQ = JSON.stringify(envScriptPath);
  const dirQ = JSON.stringify(scriptsDir);
  return [
    MCP_ENV_MARKER_START,
    "# MCP Bearer tokens for Cursor. Managed by: npm run mcp:install-shell",
    `[ -f ${scriptQ} ] && . ${scriptQ} ${dirQ}`,
    MCP_ENV_MARKER_END,
  ].join("\n");
}

function findMcpEnvMarkerSpan(content) {
  const start = content.indexOf(MCP_ENV_MARKER_START);
  if (start === -1) return null;
  const end = content.indexOf(MCP_ENV_MARKER_END, start);
  if (end === -1) return null;
  return { start, end };
}

function profileEol(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function toLf(content) {
  return content.replace(/\r\n/g, "\n");
}

function fromLf(content, eol) {
  return eol === "\r\n" ? content.replace(/\n/g, "\r\n") : content;
}

export function upsertMcpEnvMarkerBlock(content, block) {
  const eol = profileEol(content);
  const normalized = toLf(content);
  const normalizedBlock = toLf(block);
  const span = findMcpEnvMarkerSpan(normalized);
  let result;
  if (span) {
    const { start, end } = span;
    const before = normalized.slice(0, start).replace(/\n?$/, "\n");
    const after = normalized.slice(end + MCP_ENV_MARKER_END.length).replace(/^\n?/, "\n");
    result = `${before}${normalizedBlock}\n${after}`.replace(/\n$/, "") + "\n";
  } else {
    const trimmed = normalized.replace(/\n?$/, "");
    result = (trimmed ? `${trimmed}\n\n` : "") + `${normalizedBlock}\n`;
  }
  return fromLf(result, eol);
}

/** True when `command` resolves on PATH (or `where` on Windows). */
export function isCliAvailable(command, spawnFn = spawnSync) {
  const probe = platform() === "win32"
    ? spawnFn("where", [command], { encoding: "utf8" })
    : spawnFn("which", [command], { encoding: "utf8" });
  return probe.status === 0 && Boolean(probe.stdout?.trim());
}

export function extractMcpEnvMarkerBlock(content) {
  const span = findMcpEnvMarkerSpan(content);
  if (!span) return "(no managed block)";
  return content.slice(span.start, span.end + MCP_ENV_MARKER_END.length);
}

export function removeMcpEnvMarkerBlock(content) {
  const eol = profileEol(content);
  const normalized = toLf(content);
  const span = findMcpEnvMarkerSpan(normalized);
  if (!span) return content;
  const { start, end } = span;
  const before = normalized.slice(0, start).replace(/\n$/, "");
  const after = normalized.slice(end + MCP_ENV_MARKER_END.length).replace(/^\n/, "");
  let result;
  if (before && after) result = `${before}\n${after}\n`;
  else if (before) result = `${before}\n`;
  else if (after) result = `${after}\n`;
  else result = "";
  return fromLf(result, eol);
}

// ── package.json script merge ────────────────────────────────────────────

/**
 * Scripts that live only in the aiworkspace package itself and must never be
 * copied into a consumer workspace (they reference package-internal tooling).
 */
export const NON_CONSUMER_SCRIPTS = new Set(["test", "lint"]);

/**
 * Merge template scripts into a consumer's scripts, adding only missing entries.
 * Never overwrites a script the consumer already defines, and skips
 * package-internal scripts. Returns { scripts, added } where `added` lists the
 * newly inserted script names (empty when nothing changed).
 */
export function mergePackageScripts(
  consumerScripts = {},
  templateScripts = {},
  { skip = NON_CONSUMER_SCRIPTS } = {},
) {
  const scripts = { ...consumerScripts };
  const added = [];
  for (const [name, cmd] of Object.entries(templateScripts ?? {})) {
    if (skip.has(name)) continue;
    if (name in scripts) continue;
    scripts[name] = cmd;
    added.push(name);
  }
  return { scripts, added };
}

// ── git staging ──────────────────────────────────────────────────────────

/**
 * Stage changed paths in git. Returns true when staging succeeded.
 */
export function stageGitPaths(paths, { repoDir = REPO_DIR, label = "changes" } = {}) {
  if (!existsSync(join(repoDir, ".git")) || paths.length === 0) return false;
  try {
    execFileSync("git", ["add", ...paths], { cwd: repoDir, stdio: "ignore" });
    return true;
  } catch {
    console.warn(`⚠ Could not stage ${label} (git add failed).`);
    return false;
  }
}

