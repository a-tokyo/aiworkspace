#!/usr/bin/env node

/**
 * aiworkspace CLI — scaffolds a new AI workspace directory.
 *
 * Usage:
 *   npx aiworkspace init [name]
 *   npx aiworkspace init --name foo
 */

import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
const VERSION = rootPkg.version;
const REPO_URL = rootPkg.repository?.url || "https://github.com/a-tokyo/aiworkspace.git";
const DEFAULT_NAME = "workspace";

const B = "\x1b[1m", D = "\x1b[2m", G = "\x1b[32m", C = "\x1b[36m", Y = "\x1b[33m", R = "\x1b[31m", X = "\x1b[0m";

// ── Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) { console.log(VERSION); process.exit(0); }

if (args.includes("--help") || args.includes("-h") || !args.length) {
  console.log(`
${B}aiworkspace${X} v${VERSION} — scaffold an AI-ready multi-repo workspace

${B}Usage:${X}
  npx aiworkspace init [name]       Create a workspace directory (default: workspace)
  npx aiworkspace init --name foo   Same, explicit flag

${B}Examples:${X}
  ${D}$${X} mkdir ~/dev/my-org && cd ~/dev/my-org
  ${D}$${X} npx aiworkspace init
`);
  process.exit(0);
}

if (args[0] !== "init") {
  console.error(`${R}Unknown command: ${args[0]}${X}\nRun ${C}npx aiworkspace --help${X} for usage.`);
  process.exit(1);
}

const skipInstall = args.includes("--no-install");
const nameIdx = args.indexOf("--name");
if (nameIdx !== -1 && (!args[nameIdx + 1] || args[nameIdx + 1].startsWith("-"))) {
  console.error(`${R}--name requires a value.${X} Example: ${C}npx aiworkspace init --name my-workspace${X}`);
  process.exit(1);
}
const name = nameIdx !== -1 ? args[nameIdx + 1]
  : args.find((a, i) => i > 0 && !a.startsWith("-") && args[i - 1] !== "--name")
  || DEFAULT_NAME;

if (!/^[a-zA-Z0-9][\w.-]*$/.test(name) || name === "node_modules" || name === ".git") {
  console.error(`${R}Invalid name: ${name}${X}\nUse letters, numbers, hyphens, underscores, and dots. Must start with a letter or number.`);
  process.exit(1);
}

const target = resolve(process.cwd(), name);

if (existsSync(target)) {
  console.error(`${R}Directory already exists: ${name}/${X}\nPick a different name or remove it first.`);
  process.exit(1);
}

if (existsSync(join(process.cwd(), "root-config"))) {
  console.warn(`${Y}Warning: CWD already has root-config/ — you may be inside an existing workspace.${X}\n`);
}

// ── Scaffold ────────────────────────────────────────────────────────────

console.log(`\n${B}Creating workspace in ${C}${name}/${X}${B}...${X}\n`);

mkdirSync(target, { recursive: true });

// Scripts
cpSync(join(PKG_ROOT, "scripts"), join(target, "scripts"), { recursive: true });
console.log(`  ${G}+${X} scripts/`);

// Root config (AGENTS.md, README.md, empty skills dir)
mkdirSync(join(target, "root-config", ".agents", "skills"), { recursive: true });
for (const f of ["README.md", "AGENTS.md"]) {
  cpSync(join(PKG_ROOT, "root-config", f), join(target, "root-config", f));
}
writeFileSync(join(target, "root-config", "skills-lock.json"), JSON.stringify({ version: 1, skills: {} }, null, 2) + "\n");
console.log(`  ${G}+${X} root-config/`);

// .agents/README.md + empty skills dir (project-specific, separate from root-config)
mkdirSync(join(target, ".agents", "skills"), { recursive: true });
cpSync(join(PKG_ROOT, ".agents", "README.md"), join(target, ".agents", "README.md"));
console.log(`  ${G}+${X} .agents/`);

// Top-level docs
for (const f of ["README.md", "AGENTS.md", "setup.md", ".gitignore"]) {
  const src = join(PKG_ROOT, f);
  if (existsSync(src)) { cpSync(src, join(target, f)); console.log(`  ${G}+${X} ${f}`); }
}

// Attribution footer in consumer README
const readmePath = join(target, "README.md");
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, "utf8");
  writeFileSync(readmePath, readme.trimEnd() + "\n\n---\n\nBuilt with [aiworkspace](https://github.com/a-tokyo/aiworkspace)\n");
}

// local/.gitkeep
mkdirSync(join(target, "local"), { recursive: true });
writeFileSync(join(target, "local", ".gitkeep"), "");
console.log(`  ${G}+${X} local/.gitkeep`);

// package.json — derived from root, stripped of publish-only and dev-only fields
const { name: _pkgName, description: _description, bin: _bin, files: _files, license: _license, author: _author, repository: _repository, keywords: _keywords, devDependencies: _devDeps, ...basePkg } = rootPkg;
const { test: _testScript, lint: _lintScript, ...consumerScripts } = rootPkg.scripts;
const consumerPkg = {
  name: name,
  private: true,
  description: "Shared AI workspace — skills, configs, and automation for multi-repo development",
  ...basePkg,
  scripts: {
    ...consumerScripts,
    upgrade: "node scripts/upgrade.mjs",
  },
};
writeFileSync(join(target, "package.json"), JSON.stringify(consumerPkg, null, 2) + "\n");
console.log(`  ${G}+${X} package.json`);

// Patch doc paths to use the chosen name (no-op when name === DEFAULT_NAME)
const PATCHABLE_DOCS = [
  "README.md",
  "AGENTS.md",
  "setup.md",
  join(".agents", "README.md"),
  join("root-config", "README.md"),
  join("root-config", "AGENTS.md"),
];
for (const f of PATCHABLE_DOCS) {
  const p = join(target, f);
  if (!existsSync(p)) continue;
  const before = readFileSync(p, "utf8");
  const after = before.replaceAll(`${DEFAULT_NAME}/`, `${name}/`).replaceAll(`cd ${DEFAULT_NAME}`, `cd ${name}`);
  if (after !== before) writeFileSync(p, after);
}

// npm install
if (!skipInstall) {
  try {
    console.log(`\n${B}Installing dependencies...${X}\n`);
    execFileSync("npm", ["install"], { cwd: target, stdio: "inherit", shell: process.platform === "win32" });
    console.log(`\n  ${G}+${X} dependencies installed`);
  } catch {
    console.warn(`  ${Y}!${X} npm install failed — run ${C}cd ${name} && npm install${X} manually`);
  }
}

// Git init
try {
  const gitOpts = { cwd: target, stdio: "ignore" };
  execFileSync("git", ["init"], gitOpts);
  execFileSync("git", ["remote", "add", "upstream", REPO_URL], gitOpts);
  execFileSync("git", ["add", "-A"], gitOpts);
  try {
    execFileSync("git", ["commit", "-m", "initial workspace setup"], gitOpts);
  } catch {
    console.warn(`  ${Y}!${X} git commit skipped (configure git user.name / user.email first)`);
  }
  console.log(`  ${G}+${X} git repo initialized (upstream: ${D}${REPO_URL}${X})`);
} catch {
  console.warn(`  ${Y}!${X} git init skipped (git not available)`);
}

console.log(`
${G}Done!${X} Your workspace is ready.

${B}Next steps:${X}

  ${C}cd ${name}${X}
  ${C}git remote add origin <your-repo-url>${X}
  ${C}git push -u origin main${X}

Then clone your project repos alongside ${name}/ and open the parent directory
in Cursor (or your AI editor of choice).

${D}Run ${C}npm run upgrade${D} anytime to pull the latest scripts from upstream.${X}
${D}See ${name}/setup.md for the full engineering setup guide.${X}
`);
