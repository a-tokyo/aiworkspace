#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * add-skill.mjs — Thin wrapper around `skills add`.
 *
 * Extras over raw CLI:
 *   --project <repo>   Install into a sibling repo (project-specific)
 *   --no-setup         Skip running setup-skills.mjs after install
 *   Blob URL fix       Converts .../blob/main/... URLs to owner/repo shorthand
 *   Auto setup         Runs setup-skills.mjs after install for cross-repo symlinks
 *
 * Without --project, installs workspace-wide into root-config/.agents/skills/.
 * With --project <repo>, installs project-specific into <repo>/.agents/skills/.
 *
 * Usage:
 *   npm run skills:add -- blader/humanizer
 *   npm run skills:add -- owner/repo --skill react-native-best-practices
 *   npm run skills:add -- owner/repo --skill react-native-best-practices --project my-app
 *   npm run skills:add -- owner/repo --skill some-skill --project workspace
 */

import {
  ROOT_CONFIG, extractProjectArg, extractNoSetupArg,
  resolveProject, runSkillsCli, cleanCliArtifacts, runSetup, normalizeGitHubUrl,
} from "../lib.mjs";

const args = process.argv.slice(2);

const projectName = extractProjectArg(args);
const noSetup = extractNoSetupArg(args);
const cwd = resolveProject(projectName) ?? ROOT_CONFIG;

const isHelp = args.includes("--help") || args.includes("-h");
const isListOnly = isHelp || args.includes("--list") || args.includes("-l");

if (!isHelp && !isListOnly && (!args.length || args[0].startsWith("-"))) {
  console.error(`Usage: npm run skills:add -- <source> [--skill <name>] [--project <repo>]

Examples:
  npm run skills:add -- blader/humanizer
  npm run skills:add -- owner/repo --skill react-native-best-practices
  npm run skills:add -- owner/repo --skill react-native-best-practices --project my-app`);
  process.exit(1);
}

if (!isListOnly && args.length && /^https?:\/\//.test(args[0])) {
  const normalized = normalizeGitHubUrl(args[0]);
  if (normalized) {
    args[0] = normalized.source;
    // If the URL contained a skill name and --skill wasn't already passed, inject it
    if (normalized.skill && !args.includes("--skill")) {
      args.splice(1, 0, "--skill", normalized.skill);
    }
    console.warn(`Converted URL → ${args.filter(a => a !== "--yes").join(" ")}`);
  } else {
    console.error(`Unable to normalize URL: ${args[0]}\nPass a GitHub URL or owner/repo shorthand.`);
    process.exit(1);
  }
}

if (!isListOnly && !args.includes("--yes") && !args.includes("-y")) {
  args.push("--yes");
}

runSkillsCli("add", args, { cwd });

if (!isListOnly) {
  cleanCliArtifacts(cwd);
  if (!noSetup) runSetup();
}
