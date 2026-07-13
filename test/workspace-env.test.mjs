import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

let tmp;
afterEach(() => tmp?.cleanup());

function seedWorkspace(ws, parent) {
  cpSync(join(TEST_DIR, "..", "scripts"), join(ws, "scripts"), { recursive: true });
  mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
  writeFileSync(
    join(ws, "root-config", ".agents", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        github: {
          type: "http",
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: "Bearer ${env:GITHUB_PAT}" },
        },
      },
    }, null, 2) + "\n",
  );
  writeFileSync(join(parent, ".env.local"), "GITHUB_PAT=secret-from-file\n");
}

describe("workspace-env.sh", () => {
  it("no-ops when sourced without a scripts dir argument", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "parent", "ws");
    seedWorkspace(ws, join(tmp.dir, "parent"));
    const script = join(ws, "scripts", "workspace-env.sh");

    const r = spawnSync("bash", ["-c", `. "${script}"; echo ok`], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "ok");
  });

  it("loads .env.local under bash when given the scripts dir", () => {
    tmp = makeTmpDir();
    const parent = join(tmp.dir, "parent");
    const ws = join(parent, "ws");
    const scripts = join(ws, "scripts");
    seedWorkspace(ws, parent);
    writeFileSync(
      join(scripts, ".mcp-env.paths"),
      `AIWORKSPACE_NODE=${JSON.stringify(process.execPath)}\nBEARER_KEYS=GITHUB_PAT\n`,
    );

    const script = join(scripts, "workspace-env.sh");
    const r = spawnSync(
      "bash",
      ["-c", `. "${script}" "${scripts}"; printenv GITHUB_PAT`],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "secret-from-file");
  });

  it("loads .env.local under zsh when given the scripts dir", () => {
    tmp = makeTmpDir();
    const parent = join(tmp.dir, "parent");
    const ws = join(parent, "ws");
    const scripts = join(ws, "scripts");
    seedWorkspace(ws, parent);
    writeFileSync(
      join(scripts, ".mcp-env.paths"),
      `AIWORKSPACE_NODE=${JSON.stringify(process.execPath)}\nBEARER_KEYS=GITHUB_PAT\n`,
    );

    const script = join(scripts, "workspace-env.sh");
    const r = spawnSync(
      "zsh",
      ["-c", `. "${script}" "${scripts}"; printenv GITHUB_PAT`],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "secret-from-file");
  });
});
