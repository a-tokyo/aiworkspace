#!/usr/bin/env node

/**
 * Print Bearer env var names from canonical MCP config (one per line).
 */

import { readBearerKeysFromMcp } from "./lib.mjs";

for (const key of readBearerKeysFromMcp()) {
  console.log(key);
}
