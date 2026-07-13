#!/usr/bin/env node

/**
 * Print Bearer env var names from canonical MCP config (one per line).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { collectHttpBearerVars, readMcpJson, ROOT_CONFIG } from "./lib.mjs";

const path = join(ROOT_CONFIG, ".agents", "mcp.json");
if (!existsSync(path)) process.exit(0);

const parsed = readMcpJson(path);
if (!parsed) process.exit(1);

for (const key of collectHttpBearerVars(parsed.mcpServers)) {
  console.log(key);
}
