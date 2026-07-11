#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * Load parent-root .env.local and either exec a child (stdio MCP) or print HTTP headers JSON.
 * Stdlib only — no extra npm dependencies.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = dirname(SCRIPT_DIR);
const WORKSPACE = dirname(REPO_DIR);
const ENV_LOCAL = join(WORKSPACE, ".env.local");

export function parseDotenv(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function loadEnvLocal(path = ENV_LOCAL) {
  if (!existsSync(path)) return {};
  return parseDotenv(readFileSync(path, "utf8"));
}

function resolveEnvVar(varName, fileEnv, shellEnv = process.env) {
  if (fileEnv[varName]) return fileEnv[varName];
  if (shellEnv[varName]) return shellEnv[varName];
  return undefined;
}

export function buildChildEnv(fileEnv, { only = null, maps = [] } = {}) {
  const childEnv = { ...process.env };
  if (!only?.length && !maps.length) {
    Object.assign(childEnv, fileEnv);
    return childEnv;
  }
  for (const name of only ?? []) {
    const val = resolveEnvVar(name, fileEnv);
    if (val !== undefined) childEnv[name] = val;
  }
  for (const entry of maps) {
    const sep = entry.indexOf(":");
    if (sep <= 0) continue;
    const childKey = entry.slice(0, sep).trim();
    const sourceVar = entry.slice(sep + 1).trim();
    if (!childKey || !sourceVar) continue;
    const val = resolveEnvVar(sourceVar, fileEnv);
    if (val !== undefined) childEnv[childKey] = val;
  }
  return childEnv;
}

function parseArgs(argv) {
  const execIdx = argv.indexOf("--exec");
  if (execIdx !== -1) {
    const sep = argv.indexOf("--", execIdx);
    if (sep === -1 || sep + 1 >= argv.length) {
      console.error("mcp-load-env: --exec requires -- <command> [args…]");
      process.exit(1);
    }
    let only = null;
    const onlyIdx = argv.indexOf("--only");
    if (onlyIdx !== -1 && onlyIdx < execIdx && argv[onlyIdx + 1]) {
      only = argv[onlyIdx + 1].split(",").map((s) => s.trim()).filter(Boolean);
    }
    const maps = [];
    for (let i = 0; i < execIdx; i++) {
      if (argv[i] === "--map" && argv[i + 1]) maps.push(argv[++i]);
    }
    return { mode: "exec", command: argv[sep + 1], args: argv.slice(sep + 2), only, maps };
  }

  let headerName = null;
  let varName = null;
  let prefix = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--headers" && argv[i + 1]) headerName = argv[++i];
    else if (argv[i] === "--var" && argv[i + 1]) varName = argv[++i];
    else if (argv[i] === "--prefix" && argv[i + 1]) prefix = argv[++i];
  }
  if (!headerName || !varName) {
    console.error("mcp-load-env: --headers <Name> --var <ENV_KEY> [--prefix <text>]");
    process.exit(1);
  }
  return { mode: "headers", headerName, varName, prefix };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fileEnv = loadEnvLocal();

  if (opts.mode === "headers") {
    const val = resolveEnvVar(opts.varName, fileEnv) ?? "";
    if (!val) process.exit(0);
    const headerVal = `${opts.prefix}${val}`;
    process.stdout.write(JSON.stringify({ [opts.headerName]: headerVal }));
    return;
  }

  const childEnv = buildChildEnv(fileEnv, { only: opts.only, maps: opts.maps });
  const r = spawnSync(opts.command, opts.args, {
    env: childEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.error) {
    console.error(`mcp-load-env: ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

const cliArgv = process.argv.slice(2);
if (cliArgv.includes("--exec") || cliArgv.includes("--headers")) {
  main();
}
