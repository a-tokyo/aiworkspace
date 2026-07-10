import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";

const REAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let tmp;
afterEach(() => tmp?.cleanup());

function seedCheckScripts(ws) {
  cpSync(join(REAL, "scripts"), join(ws, "scripts"), { recursive: true });
}

describe("mcp-check-secrets", () => {
  it("warns when wrapped server has missing --only vars in .env.local", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: {
            type: "stdio",
            command: "node",
            args: [
              "ws/scripts/mcp-load-env.mjs",
              "--only", "MY_API_KEY",
              "--exec", "--", "npx", "-y", "some-mcp",
            ],
          },
        },
      }, null, 2) + "\n",
    );
    writeFileSync(join(tmp.dir, ".env.local"), "# empty\n");

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
      env: { ...process.env, MY_API_KEY: "" },
    });
    assert.equal(r.status, 0);
    assert.match(`${r.stderr}${r.stdout}`, /MY_API_KEY/);
  });

  it("stays silent when wrapped server vars are present", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: {
            type: "stdio",
            command: "node",
            args: [
              "ws/scripts/mcp-load-env.mjs",
              "--only", "MY_API_KEY",
              "--exec", "--", "npx", "-y", "some-mcp",
            ],
          },
        },
      }, null, 2) + "\n",
    );
    writeFileSync(join(tmp.dir, ".env.local"), "MY_API_KEY=secret\n");

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
      env: { ...process.env, MY_API_KEY: "" },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
  });
});
