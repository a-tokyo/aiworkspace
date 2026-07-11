#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * Warn when MCP config references secret env vars missing from parent-root `.env.local`.
 * Exits silently when the canonical MCP config is absent. HTTP Bearer `${VAR}` header
 * portability hints are emitted regardless of whether `.env.local` exists. When wrapped
 * stdio servers need secrets but `.env.local` is missing, emits a non-fatal hint to
 * create it from `.env.example`. Missing-secret value warnings require `.env.local`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT_CONFIG, readMcpJson, WORKSPACE,
  secretVarsForMcpServer, httpBearerVarsForMcpServer, isMcpLoadEnvWrapped,
} from "./lib.mjs";
import { loadEnvLocal } from "./mcp-load-env.mjs";

const path = join(ROOT_CONFIG, ".agents", "mcp.json");
if (!existsSync(path)) process.exit(0);

const parsed = readMcpJson(path);
if (!parsed) process.exit(0);

// stdio servers whose secrets load from .env.local via the env loader.
const required = new Set();
// HTTP servers that carry a Bearer ${VAR} header — not portable across editors.
const httpBearer = [];
for (const [name, config] of Object.entries(parsed.mcpServers)) {
  if (config?.type === "stdio" && isMcpLoadEnvWrapped(config)) {
    for (const v of secretVarsForMcpServer(name, config)) required.add(v);
  }
  const bearerVars = httpBearerVarsForMcpServer(config);
  if (bearerVars.size > 0) httpBearer.push({ name, vars: [...bearerVars] });
}

if (httpBearer.length > 0) {
  console.warn("\n⚠ MCP HTTP servers using a Bearer token header:");
  for (const { name, vars } of httpBearer) {
    console.warn(`  - ${name} (Authorization: Bearer \${${vars.join(", ")}})`);
  }
  console.warn(
    "\nNot every editor expands .env.local into HTTP headers (Cursor does not).",
  );
  console.warn(
    "Prefer the server's OAuth endpoint (plain { type: \"http\", url }) so sign-in happens in the editor — no token needed.\n",
  );
}

if (required.size === 0) process.exit(0);

const envLocalPath = join(WORKSPACE, ".env.local");
if (!existsSync(envLocalPath)) {
  console.warn("\n⚠ MCP config references secret env vars but .env.local is missing at parent workspace root.");
  console.warn(`  Required: ${[...required].sort().join(", ")}`);
  console.warn("  Create it: cp .env.example .env.local  (from parent root, not workspace/)");
  console.warn("  Then fill tokens and restart the editor (setup.md §4.1).\n");
  process.exit(0);
}

const fileEnv = loadEnvLocal(envLocalPath);
// A var counts as present only when it resolves to a non-empty value — an empty
// placeholder like `MY_API_KEY=` (e.g. straight after copying .env.example) is
// still "missing", matching how mcp-load-env resolves secrets.
const hasValue = (v) => {
  const fromFile = fileEnv[v];
  if (typeof fromFile === "string" && fromFile !== "") return true;
  const fromShell = process.env[v];
  return typeof fromShell === "string" && fromShell !== "";
};
const missing = [...required].filter((v) => !hasValue(v));
if (missing.length === 0) process.exit(0);

console.warn("\n⚠ MCP secret env vars missing from .env.local:");
for (const v of missing.sort()) console.warn(`  - ${v}`);
console.warn(`\nFill tokens in .env.local at parent workspace root, then restart the editor (setup.md §4.1).\n`);
