import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

let tmp;
afterEach(() => tmp?.cleanup());

describe("mcp-bearer-env-keys", () => {
  it("prints sorted Bearer keys one per line", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    cpSync(join(TEST_DIR, "..", "scripts"), join(ws, "scripts"), { recursive: true });
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          b: {
            type: "http",
            url: "https://example.com",
            headers: { Authorization: "Bearer ${env:Z_TOKEN}" },
          },
          a: {
            type: "http",
            url: "https://example.com",
            headers: { Authorization: "Bearer ${env:A_TOKEN}" },
          },
        },
      }, null, 2) + "\n",
    );

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-bearer-env-keys.mjs")], {
      cwd: ws,
      encoding: "utf8",
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "A_TOKEN\nZ_TOKEN");
  });
});
