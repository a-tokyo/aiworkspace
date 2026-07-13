#!/usr/bin/env node

/**
 * Opt-in shell profile installer for HTTP Bearer MCP env vars (Cursor).
 *
 * Appends or updates a marked block in ~/.zshrc, ~/.bashrc, and/or PowerShell $PROFILE.
 * Writes scripts/.mcp-env.paths with the absolute node binary used at install time.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  REPO_DIR,
  ROOT_CONFIG,
  readMcpJson,
  collectHttpBearerVars,
  buildMcpEnvMarkerBlock,
  upsertMcpEnvMarkerBlock,
  removeMcpEnvMarkerBlock,
  extractMcpEnvMarkerBlock,
  isCliAvailable,
  MCP_ENV_MARKER_START,
} from "./lib.mjs";
import { loadEnvLocal } from "./mcp-load-env.mjs";

const PATHS_FILE = join(REPO_DIR, "scripts", ".mcp-env.paths");
const ENV_SH = join(REPO_DIR, "scripts", "workspace-env.sh");
const ENV_PS1 = join(REPO_DIR, "scripts", "workspace-env.ps1");

function parseArgs(argv) {
  const opts = { uninstall: false, yes: false, persist: false, shell: "all" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--uninstall") opts.uninstall = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--persist") opts.persist = true;
    else if (a === "--shell") {
      opts.shell = argv[++i] ?? "all";
    } else if (a === "--help" || a === "-h") {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: npm run mcp:install-shell [-- --yes] [--shell zsh|bash|pwsh|all]
       npm run mcp:uninstall-shell [-- --yes] [--shell zsh|bash|pwsh|all]

Options:
  --yes        Apply without confirmation (required when stdin is not a TTY)
  --shell      Profile to update (default: all applicable)
  --uninstall  Remove the marked block only
  --persist    Windows only: write User environment variables for Bearer keys
`);
}

function bearerKeysFromMcp() {
  const path = join(ROOT_CONFIG, ".agents", "mcp.json");
  if (!existsSync(path)) return [];
  const parsed = readMcpJson(path);
  if (!parsed) return [];
  return collectHttpBearerVars(parsed.mcpServers);
}

function resolveNodeBin() {
  const node = process.execPath;
  if (!node || !existsSync(node)) {
    throw new Error("Could not resolve node binary for shell profile (process.execPath missing).");
  }
  return resolve(node);
}

function writePathsFile(nodeBin) {
  const content = `AIWORKSPACE_NODE=${JSON.stringify(nodeBin)}\n`;
  mkdirSync(join(REPO_DIR, "scripts"), { recursive: true });
  writeFileSync(PATHS_FILE, content);
}

function defaultPwshProfile(home) {
  if (platform() === "win32") {
    const docs = process.env.USERPROFILE ?? home;
    return join(docs, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
  }
  return join(home, ".config", "powershell", "Microsoft.PowerShell_profile.ps1");
}

function pwshAvailable(pwshProfile) {
  if (existsSync(pwshProfile)) return true;
  return isCliAvailable("pwsh");
}

function profileTargets(shell, home = homedir()) {
  const all = {
    zsh: join(home, ".zshrc"),
    bash: join(home, ".bashrc"),
    pwsh: process.env.AIWORKSPACE_PWSH_PROFILE ?? defaultPwshProfile(home),
  };
  if (shell === "all") {
    const targets = [];
    if (platform() !== "win32") {
      targets.push(["zsh", all.zsh], ["bash", all.bash]);
      if (pwshAvailable(all.pwsh)) targets.push(["pwsh", all.pwsh]);
      return targets;
    }
    targets.push(["pwsh", all.pwsh]);
    return targets;
  }
  if (!(shell in all)) throw new Error(`Unknown --shell ${shell}`);
  return [[shell, all[shell]]];
}

function readProfile(path) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function writeProfile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function renderDiff(before, after, label) {
  const beforeBlock = extractMcpEnvMarkerBlock(before);
  const afterBlock = extractMcpEnvMarkerBlock(after);
  if (beforeBlock === afterBlock) {
    console.log(`  (no changes) ${label}`);
    return;
  }
  console.log(`\n--- ${label} (managed block, before)`);
  console.log(beforeBlock);
  console.log(`+++ ${label} (managed block, after)`);
  console.log(afterBlock);
}

async function confirmApply(changes) {
  if (changes.length === 0) {
    console.log("Nothing to change.");
    return false;
  }
  for (const { label, before, after } of changes) {
    renderDiff(before, after, label);
  }
  if (!input.isTTY) {
    console.error("\nNon-interactive shell: re-run with --yes to apply.");
    return false;
  }
  const rl = createInterface({ input, output });
  const answer = await rl.question("\nApply these profile changes? [y/N] ");
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function persistWindowsUserEnv(keys) {
  if (platform() !== "win32" || keys.length === 0) return;
  const envFile = join(resolve(REPO_DIR, ".."), ".env.local");
  if (!existsSync(envFile)) {
    console.warn("  ⚠ --persist: .env.local missing at parent workspace root — skipped User env write");
    return;
  }
  const fileEnv = loadEnvLocal(envFile);
  for (const key of keys) {
    const value = fileEnv[key];
    if (typeof value !== "string" || value === "") continue;
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `[Environment]::SetEnvironmentVariable('${key.replace(/'/g, "''")}', '${value.replace(/'/g, "''")}', 'User')`,
      ],
      { stdio: "ignore" },
    );
    if (r.error) {
      console.warn(`  ⚠ Could not set User env ${key}: ${r.error.message}`);
    } else if (r.status !== 0) {
      console.warn(`  ⚠ Could not set User env ${key}: powershell exited ${r.status}`);
    } else {
      console.log(`  ✓ User env: ${key}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const keys = bearerKeysFromMcp();
  if (keys.length === 0) {
    console.log("No HTTP Bearer MCP servers in mcp.json — nothing to install.");
    return;
  }

  const nodeBin = resolveNodeBin();
  if (!opts.uninstall) writePathsFile(nodeBin);

  const targets = profileTargets(opts.shell);
  const changes = [];

  for (const [shell, profilePath] of targets) {
    const before = readProfile(profilePath);
    let after;
    if (opts.uninstall) {
      after = removeMcpEnvMarkerBlock(before);
      if (after === before) continue;
    } else {
      const scriptPath = shell === "pwsh" ? ENV_PS1 : ENV_SH;
      const block = buildMcpEnvMarkerBlock({ shell, envScriptPath: scriptPath });
      after = upsertMcpEnvMarkerBlock(before, block);
      if (after === before && before.includes(MCP_ENV_MARKER_START)) continue;
    }
    changes.push({ shell, profilePath, label: profilePath, before, after });
  }

  if (changes.length === 0) {
    console.log(opts.uninstall ? "Marked block not found in selected profiles." : "Profiles already up to date.");
    return;
  }

  const ok = opts.yes || await confirmApply(changes);
  if (!ok) {
    console.log("Cancelled.");
    process.exit(1);
  }

  for (const { profilePath, after } of changes) {
    writeProfile(profilePath, after);
    console.log(`  ✓ ${profilePath}`);
  }

  if (!opts.uninstall && opts.persist) {
    persistWindowsUserEnv(keys);
  }

  console.log("\nRestart Cursor (full quit) so Bearer MCP headers pick up the new environment.");
  if (platform() === "darwin") {
    console.log("On macOS, Dock-launched Cursor uses launchctl vars set when your profile loads.");
  }
}

main().catch((err) => {
  console.error(`install-shell-profile failed: ${err.message}`);
  process.exit(1);
});
