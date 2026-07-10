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
import { MCP_ENV_ALIAS_GROUPS } from "./lib.mjs";

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

export function applyMcpEnvAliases(parsed) {
  for (const group of MCP_ENV_ALIAS_GROUPS) {
    for (const from of group) {
      if (!parsed[from]) continue;
      for (const to of group) {
        if (from !== to && !parsed[to]) parsed[to] = parsed[from];
      }
    }
  }
  return parsed;
}

export function loadEnvLocal(path = ENV_LOCAL) {
  if (!existsSync(path)) return {};
  return applyMcpEnvAliases(parseDotenv(readFileSync(path, "utf8")));
}

export function resolveMcpEnvVar(varName, fileEnv, shellEnv = process.env) {
  if (fileEnv[varName]) return fileEnv[varName];
  if (shellEnv[varName]) return shellEnv[varName];
  const group = MCP_ENV_ALIAS_GROUPS.find((g) => g.includes(varName));
  if (!group) return undefined;
  for (const alias of group) {
    if (fileEnv[alias]) return fileEnv[alias];
    if (shellEnv[alias]) return shellEnv[alias];
  }
  return undefined;
}

function buildChildEnv(fileEnv, only) {
  const childEnv = { ...process.env };
  if (!only?.length) {
    Object.assign(childEnv, fileEnv);
    return childEnv;
  }
  for (const name of only) {
    const val = resolveMcpEnvVar(name, fileEnv);
    if (val !== undefined) childEnv[name] = val;
  }
  return applyMcpEnvAliases(childEnv);
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
    return { mode: "exec", command: argv[sep + 1], args: argv.slice(sep + 2), only };
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
    const val = resolveMcpEnvVar(opts.varName, fileEnv) ?? "";
    if (!val) process.exit(0);
    const headerVal = `${opts.prefix}${val}`;
    process.stdout.write(JSON.stringify({ [opts.headerName]: headerVal }));
    return;
  }

  const childEnv = buildChildEnv(fileEnv, opts.only);
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
