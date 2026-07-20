import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, chmodSync, lstatSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir, runScript } from "./helpers.mjs";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INIT_SCRIPT = join(PKG_ROOT, "bin", "aiworkspace.mjs");
const ROOT_PKG = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
const IS_WIN = process.platform === "win32";

/** Populate workspace/node_modules/aiworkspace from the real package so upgrade's
 *  local-package path resolves (mirrors what `npm install` would produce). */
function seedInstalledPackage(ws) {
  const nm = join(ws, "node_modules", "aiworkspace");
  mkdirSync(nm, { recursive: true });
  cpSync(join(PKG_ROOT, "scripts"), join(nm, "scripts"), { recursive: true });
  cpSync(join(PKG_ROOT, "root-config"), join(nm, "root-config"), { recursive: true });
  writeFileSync(
    join(nm, "package.json"),
    JSON.stringify({ name: "aiworkspace", version: ROOT_PKG.version, scripts: ROOT_PKG.scripts }) + "\n",
  );
}

function fakeNpmBin(parentDir) {
  const binDir = join(parentDir, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const npm = join(binDir, IS_WIN ? "npm.cmd" : "npm");
  if (IS_WIN) writeFileSync(npm, "@echo off\nexit /b 0\n");
  else { writeFileSync(npm, "#!/bin/sh\nexit 0\n"); chmodSync(npm, 0o755); }
  return binDir;
}

describe("MCP out-of-the-box (init + upgrade)", () => {
  let tmp;
  afterEach(() => tmp?.cleanup());

  it("scaffolds a working MCP setup across editors after init then upgrade", () => {
    tmp = makeTmpDir();

    const init = runScript(INIT_SCRIPT, ["init", "--no-install"], { cwd: tmp.dir });
    assert.equal(init.exitCode, 0, init.stderr);

    const ws = join(tmp.dir, "workspace");
    seedInstalledPackage(ws);
    const binDir = fakeNpmBin(tmp.dir);

    const r = spawnSync(process.execPath, [join("scripts", "upgrade.mjs")], {
      cwd: ws,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}${IS_WIN ? ";" : ":"}${process.env.PATH}` },
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);

    const rc = join(ws, "root-config");

    const canonical = join(rc, ".agents", "mcp.json");
    assert.ok(existsSync(canonical), "canonical mcp.json should exist");
    assert.ok(readFileSync(canonical, "utf8").includes("context7"), "bundled context7 server should be present");

    assert.ok(lstatSync(join(rc, ".mcp.json")).isSymbolicLink(), ".mcp.json (Claude Code) should be a symlink to canonical");
    assert.ok(!lstatSync(join(rc, ".cursor", "mcp.json")).isSymbolicLink(), ".cursor/mcp.json should be a generated twin, not a symlink");
    assert.ok(existsSync(join(rc, ".codex", "config.toml")), "codex twin should exist");
    assert.ok(existsSync(join(rc, ".vscode", "mcp.json")), "vscode twin should exist");
    assert.ok(existsSync(join(rc, ".env.example")), ".env.example should exist");

    const cursorTwin = JSON.parse(readFileSync(join(rc, ".cursor", "mcp.json"), "utf8"));
    assert.ok(cursorTwin.mcpServers?.context7, "cursor twin should project the context7 server");

    assert.ok(existsSync(join(tmp.dir, ".mcp.json")), "parent-root .mcp.json symlink should exist after mirror");
    assert.ok(existsSync(join(tmp.dir, ".cursor", "mcp.json")), "parent-root .cursor/mcp.json should exist after mirror");

    const pkg = JSON.parse(readFileSync(join(ws, "package.json"), "utf8"));
    assert.equal(
      pkg.scripts?.["mcp:check-secrets"],
      "node scripts/mcp-check-secrets.mjs",
      "mcp:check-secrets script should be present out of the box",
    );

    const vscode = JSON.parse(readFileSync(join(rc, ".vscode", "mcp.json"), "utf8"));
    assert.ok(vscode.servers?.context7, "vscode twin should project the context7 server");
  });
});
