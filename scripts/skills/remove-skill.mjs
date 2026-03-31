#!/usr/bin/env node

/**
 * @managed by aiworkspace — https://github.com/a-tokyo/aiworkspace
 * This file is overwritten by `npm run upgrade`. Edit with care.
 *
 * remove-skill.mjs — Thin wrapper around `skills remove`.
 *
 * Extras over raw CLI:
 *   --project <repo>   Remove from a sibling repo (project-specific)
 *   --no-setup         Skip running setup-skills.mjs after removal
 *   Auto setup         Runs setup-skills.mjs to clean stale cross-repo symlinks
 *
 * Without --project, removes workspace-wide skill from root-config/.agents/skills/.
 * With --project <repo>, removes project-specific skill from <repo>/.agents/skills/.
 *
 * Usage:
 *   npm run skills:remove                              # interactive (workspace-wide)
 *   npm run skills:remove -- humanizer                  # by name (workspace-wide)
 *   npm run skills:remove -- some-skill --project my-app
 *   npm run skills:remove -- some-skill --project workspace
 */

import {
  ROOT_CONFIG, extractProjectArg, extractNoSetupArg,
  resolveProject, runSkillsCli, cleanCliArtifacts, cleanLockEntry, runSetup,
} from "../lib.mjs";

const args = process.argv.slice(2);

const projectName = extractProjectArg(args);
const noSetup = extractNoSetupArg(args);
const cwd = resolveProject(projectName) ?? ROOT_CONFIG;

const skillName = args.find(a => !a.startsWith("-"));
const hasSkillName = !!skillName;
if (hasSkillName && !args.includes("--yes") && !args.includes("-y")) {
  args.push("--yes");
}

runSkillsCli("remove", args, { cwd });
cleanCliArtifacts(cwd);
if (hasSkillName) cleanLockEntry(cwd, skillName);
if (!noSetup) runSetup();
