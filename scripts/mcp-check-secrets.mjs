#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * Warn when MCP config references env vars that are unset in the current shell.
 * Non-fatal — fresh clones won't have tokens yet.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT_CONFIG, readMcpJson, WORKSPACE, secretVarsForMcpServer } from "./lib.mjs";
import { loadEnvLocal } from "./mcp-load-env.mjs";

const path = join(ROOT_CONFIG, ".agents", "mcp.json");
if (!existsSync(path)) process.exit(0);

const parsed = readMcpJson(path);
if (!parsed) process.exit(0);

const required = new Set();
for (const [name, config] of Object.entries(parsed.mcpServers)) {
  for (const v of secretVarsForMcpServer(name, config)) required.add(v);
}

if (required.size === 0) process.exit(0);

const envLocalPath = join(WORKSPACE, ".env.local");
if (!existsSync(envLocalPath)) process.exit(0);

const fileEnv = loadEnvLocal(envLocalPath);
const missing = [...required].filter((v) => !(v in fileEnv) && !process.env[v]);
if (missing.length === 0) process.exit(0);

console.warn("\n⚠ MCP secret env vars missing from .env.local:");
for (const v of missing.sort()) console.warn(`  - ${v}`);
console.warn(`\nFill tokens in .env.local at parent workspace root, then restart the editor (setup.md §4.1).\n`);
