#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * sync.mjs — Regenerate MCP twins and mirror root-config to the parent root.
 *
 * Use after editing root-config/ (especially .agents/mcp.json). Does not
 * update managed scripts/ or run npm update aiworkspace.
 */

import { join, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REPO_DIR, runSetup, stageGitPaths } from "./lib.mjs";
import { upgradeMcp, upgradeEnvScaffold } from "./upgrade-mcp.mjs";

/**
 * Resolve MCP template root: prefer installed aiworkspace package, else local root-config.
 */
export function resolveTemplateRoot(repoDir = REPO_DIR) {
  const fromPackage = join(repoDir, "node_modules", "aiworkspace", "root-config");
  if (existsSync(fromPackage)) return fromPackage;
  const local = join(repoDir, "root-config");
  if (existsSync(local)) return local;
  return null;
}

/**
 * Merge MCP configs, scaffold env files, and mirror root-config to parent root.
 * Returns git-relative paths that changed.
 */
export function runSync({ templateRoot, repoDir = REPO_DIR } = {}) {
  const root = templateRoot ?? resolveTemplateRoot(repoDir);
  if (!root || !existsSync(root)) {
    throw new Error(
      "MCP template not found — run `npm run sync` from your workspace repo (needs root-config/ or node_modules/aiworkspace).",
    );
  }

  console.log("\n🔄 Syncing workspace configs...\n");

  const { changedPaths: envPaths } = upgradeEnvScaffold({ templateRoot: root, repoDir });
  const { changedPaths: mcpPaths } = upgradeMcp({ templateRoot: root, repoDir });
  runSetup({ ensure: true, repoDir });

  const changedPaths = [...envPaths, ...mcpPaths];
  console.log("Workspace synced.\n");
  return { changedPaths };
}

function main() {
  try {
    const templateRoot = resolveTemplateRoot();
    const { changedPaths } = runSync({ templateRoot });

    if (stageGitPaths(changedPaths)) {
      console.log("Staged sync changes — review with: git diff --cached");
    }
  } catch (err) {
    console.error(`Sync failed: ${err.message}`);
    process.exit(1);
  }
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url))
      === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isCliEntry()) main();
