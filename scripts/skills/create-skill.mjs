#!/usr/bin/env node

/**
 * @managed by aiworkspace — https://github.com/a-tokyo/aiworkspace
 * This file is overwritten by `npm run upgrade`. Edit with care.
 *
 * create-skill.mjs — Create a new manual skill scaffold.
 *
 * Without --project: creates in root-config/.agents/skills/ (workspace-wide)
 * With --project:    creates in <repo>/.agents/skills/ (project-specific)
 *
 * Usage:
 *   node scripts/skills/create-skill.mjs --name code-review
 *   node scripts/skills/create-skill.mjs --name lint-rules --project my-app
 *   node scripts/skills/create-skill.mjs --name my-skill --project workspace
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_SKILLS, extractProjectArg, extractNoSetupArg, resolveProject, runSetup,
} from "../lib.mjs";

const args = process.argv.slice(2);

const projectName = extractProjectArg(args);
const noSetup = extractNoSetupArg(args);

const nameIdx = args.indexOf("--name");
const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
if (!name || name.startsWith("-")) {
  console.error("Missing --name. Example: --name code-review");
  process.exit(1);
}
if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(name)) {
  console.error("Invalid name. Use lowercase letters, numbers, hyphens, underscores, and dots (max 64 chars, must start and end with a letter or number).");
  process.exit(1);
}

const baseDir = projectName
  ? join(resolveProject(projectName), ".agents", "skills")
  : CANONICAL_SKILLS;

const skillFile = join(baseDir, name, "SKILL.md");

if (existsSync(skillFile)) {
  console.error(`Skill already exists: ${skillFile}`);
  process.exit(1);
}

mkdirSync(join(baseDir, name), { recursive: true });

const title = name.split(/[-_.]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
writeFileSync(skillFile, `---
name: ${name}
description: Describe what this skill does and when to use it.
---

# ${title}

## Instructions
- Add step-by-step guidance here.

## Examples
- Add a concrete example here.
`, "utf8");

console.log(`Created ${skillFile}`);
if (!noSetup) runSetup();
