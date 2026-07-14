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
  WORKSPACE,
  buildMcpEnvMarkerBlock,
  upsertMcpEnvMarkerBlock,
  removeMcpEnvMarkerBlock,
  extractMcpEnvMarkerBlock,
  isCliAvailable,
  mcpEnvInstanceId,
  readBearerKeysFromMcp,
  readBearerKeysFromPathsFile,
  resolvePwshProfilePath,
} from "./lib.mjs";

const PATHS_FILE = join(REPO_DIR, "scripts", ".mcp-env.paths");
const ENV_SH = join(REPO_DIR, "scripts", "workspace-env.sh");
const ENV_PS1 = join(REPO_DIR, "scripts", "workspace-env.ps1");
const PERSIST_PS1 = join(REPO_DIR, "scripts", "persist-user-env.ps1");
const SHELL_VALUES = new Set(["all", "zsh", "bash", "pwsh"]);

function parseArgs(argv) {
  const opts = { uninstall: false, yes: false, persist: false, shell: "all" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--uninstall") opts.uninstall = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--persist") opts.persist = true;
    else if (a === "--shell") {
      const next = argv[++i];
      if (!next || next.startsWith("--") || !SHELL_VALUES.has(next)) {
        throw new Error(`--shell requires one of: ${[...SHELL_VALUES].join(", ")}`);
      }
      opts.shell = next;
    } else if (a === "--help" || a === "-h") {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: npm run mcp:install-shell -- [--yes] [--shell zsh|bash|pwsh|all] [--persist]
       npm run mcp:uninstall-shell -- [--yes] [--shell zsh|bash|pwsh|all]

Pass flags after -- when using npm run.
Or: node scripts/install-shell-profile.mjs [--yes] [--shell ...] [--persist] [--uninstall]

Options:
  --yes        Apply without confirmation (required when stdin is not a TTY)
  --shell      Profile to update (default: all applicable)
  --uninstall  Remove the marked block only
  --persist    Windows only: write User environment variables for Bearer keys
`);
}

function bearerKeysForCleanup() {
  const fromMcp = readBearerKeysFromMcp();
  if (fromMcp.length) return fromMcp;
  return readBearerKeysFromPathsFile(PATHS_FILE);
}

function resolveNodeBin() {
  const node = process.execPath;
  if (!node || !existsSync(node)) {
    throw new Error("Could not resolve node binary for shell profile (process.execPath missing).");
  }
  return resolve(node);
}

function writePathsFile(nodeBin, bearerKeys) {
  const lines = [`AIWORKSPACE_NODE=${JSON.stringify(nodeBin)}`];
  if (bearerKeys?.length) lines.push(`BEARER_KEYS=${bearerKeys.join(",")}`);
  mkdirSync(join(REPO_DIR, "scripts"), { recursive: true });
  writeFileSync(PATHS_FILE, `${lines.join("\n")}\n`);
}

function profileTargets(shell, home = homedir()) {
  const profiles = {
    zsh: join(home, ".zshrc"),
    bash: join(home, ".bashrc"),
    pwsh: resolvePwshProfilePath(home),
  };
  if (shell === "all") {
    const targets = [];
    if (platform() !== "win32") {
      targets.push(["zsh", profiles.zsh], ["bash", profiles.bash]);
      if (isCliAvailable("pwsh") || existsSync(profiles.pwsh)) targets.push(["pwsh", profiles.pwsh]);
      return targets;
    }
    targets.push(["pwsh", profiles.pwsh]);
    return targets;
  }
  if (!Object.hasOwn(profiles, shell)) throw new Error(`Unknown --shell ${shell}`);
  return [[shell, profiles[shell]]];
}

function readProfile(path) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function writeProfile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function renderDiff(before, after, label, id) {
  const beforeBlock = extractMcpEnvMarkerBlock(before, id);
  const afterBlock = extractMcpEnvMarkerBlock(after, id);
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
  for (const { label, before, after, id } of changes) {
    renderDiff(before, after, label, id);
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
  const envFile = join(WORKSPACE, ".env.local");
  if (!existsSync(envFile)) {
    console.warn("  ⚠ --persist: .env.local missing at parent workspace root — skipped User env write");
    return;
  }
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-File", PERSIST_PS1, "-EnvFile", envFile, "-KeysCsv", keys.join(",")],
    { stdio: "inherit" },
  );
  if (r.error) {
    console.warn(`  ⚠ Could not persist User env: ${r.error.message}`);
  } else if (r.status !== 0) {
    console.warn(`  ⚠ Could not persist User env: powershell exited ${r.status}`);
  } else {
    for (const key of keys) console.log(`  ✓ User env: ${key}`);
  }
}

function clearMacLaunchctlEnv(keys) {
  if (platform() !== "darwin" || keys.length === 0) return;
  for (const key of keys) {
    const r = spawnSync("launchctl", ["unsetenv", key], { stdio: "ignore" });
    if (r.status === 0) console.log(`  ✓ launchctl unsetenv ${key}`);
  }
}

function clearWindowsUserEnv(keys) {
  if (platform() !== "win32" || keys.length === 0) return;
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-File", PERSIST_PS1, "-KeysCsv", keys.join(","), "-Clear"],
    { stdio: "inherit" },
  );
  if (r.error) {
    console.warn(`  ⚠ Could not clear User env: ${r.error.message}`);
  } else if (r.status !== 0) {
    console.warn(`  ⚠ Could not clear User env: powershell exited ${r.status}`);
  } else {
    for (const key of keys) console.log(`  ✓ User env cleared: ${key}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const keys = readBearerKeysFromMcp();
  if (keys.length === 0 && !opts.uninstall) {
    console.log("No HTTP Bearer MCP servers in mcp.json — nothing to install.");
    return;
  }

  const cleanupKeys = opts.uninstall ? bearerKeysForCleanup() : keys;
  const nodeBin = opts.uninstall ? null : resolveNodeBin();
  const instanceId = mcpEnvInstanceId({ repoDir: REPO_DIR, create: !opts.uninstall });

  const targets = profileTargets(opts.shell);
  const changes = [];

  for (const [shell, profilePath] of targets) {
    const before = readProfile(profilePath);
    const scriptPath = shell === "pwsh" ? ENV_PS1 : ENV_SH;
    const block = buildMcpEnvMarkerBlock({ shell, envScriptPath: scriptPath, id: instanceId });
    let after;
    if (opts.uninstall) {
      after = removeMcpEnvMarkerBlock(before, { id: instanceId, block });
    } else {
      after = upsertMcpEnvMarkerBlock(before, { id: instanceId, block });
    }
    if (after === before) continue;
    changes.push({ shell, profilePath, label: profilePath, before, after, id: instanceId });
  }

  if (changes.length === 0) {
    if (!opts.uninstall && nodeBin) {
      writePathsFile(nodeBin, keys);
      console.log("Profiles already up to date. Refreshed scripts/.mcp-env.paths.");
      return;
    }
    console.log(opts.uninstall ? "Marked block not found in selected profiles." : "Profiles already up to date.");
    return;
  }

  const ok = opts.yes || await confirmApply(changes);
  if (!ok) {
    console.log("Cancelled.");
    process.exit(1);
  }

  if (nodeBin) writePathsFile(nodeBin, keys);

  for (const { profilePath, after } of changes) {
    writeProfile(profilePath, after);
    console.log(`  ✓ ${profilePath}`);
  }

  if (opts.uninstall) {
    clearMacLaunchctlEnv(cleanupKeys);
    clearWindowsUserEnv(cleanupKeys);
  } else if (opts.persist) {
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
