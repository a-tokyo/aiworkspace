import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";
import { parseDotenv, loadEnvLocal } from "../scripts/mcp-load-env.mjs";

const REAL = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(REAL, "..", "scripts", "mcp-load-env.mjs");

let tmp;
afterEach(() => tmp?.cleanup());

describe("mcp-load-env", () => {
  it("parseDotenv skips comments and parses quoted values", () => {
    const out = parseDotenv(`
# comment
FOO=bar
BAZ="quoted"
`);
    assert.equal(out.FOO, "bar");
    assert.equal(out.BAZ, "quoted");
  });

  it("loadEnvLocal aliases GITHUB_PAT to GITHUB_PERSONAL_ACCESS_TOKEN", () => {
    tmp = makeTmpDir();
    const envPath = join(tmp.dir, ".env.local");
    writeFileSync(envPath, "GITHUB_PAT=ghp_test\n");
    const out = loadEnvLocal(envPath);
    assert.equal(out.GITHUB_PAT, "ghp_test");
    assert.equal(out.GITHUB_PERSONAL_ACCESS_TOKEN, "ghp_test");
  });

  it("--headers prints JSON authorization header", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "workspace");
    mkdirSync(join(ws, "scripts"), { recursive: true });
    cpSync(join(REAL, "..", "scripts", "lib.mjs"), join(ws, "scripts", "lib.mjs"));
    cpSync(SCRIPT, join(ws, "scripts", "mcp-load-env.mjs"));
    writeFileSync(join(tmp.dir, ".env.local"), "GITHUB_PAT=secret-token\n");
    const r = spawnSync(process.execPath, [
      join(ws, "scripts", "mcp-load-env.mjs"),
      "--headers", "Authorization",
      "--var", "GITHUB_PAT",
      "--prefix", "Bearer ",
    ], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { Authorization: "Bearer secret-token" });
  });

  it("loadEnvLocal aliases GITHUB_PERSONAL_ACCESS_TOKEN to GITHUB_PAT", () => {
    tmp = makeTmpDir();
    const envPath = join(tmp.dir, ".env.local");
    writeFileSync(envPath, "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_reverse\n");
    const out = loadEnvLocal(envPath);
    assert.equal(out.GITHUB_PERSONAL_ACCESS_TOKEN, "ghp_reverse");
    assert.equal(out.GITHUB_PAT, "ghp_reverse");
  });

  it("--only passes only requested vars to child", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "workspace");
    const scripts = join(ws, "scripts");
    const child = join(tmp.dir, "print-env.mjs");
    writeFileSync(join(tmp.dir, ".env.local"), "TEST_MCP_SECRET=from-file\nOTHER_SECRET=hidden\n");
    writeFileSync(child, `console.log(JSON.stringify({
      secret: process.env.TEST_MCP_SECRET || "",
      other: process.env.OTHER_SECRET || "",
    }));\n`);
    mkdirSync(scripts, { recursive: true });
    cpSync(join(REAL, "..", "scripts", "lib.mjs"), join(scripts, "lib.mjs"));
    cpSync(SCRIPT, join(scripts, "mcp-load-env.mjs"));

    const r = spawnSync(process.execPath, [
      join(scripts, "mcp-load-env.mjs"),
      "--only", "TEST_MCP_SECRET",
      "--exec", "--", process.execPath, child,
    ], { cwd: ws, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.secret, "from-file");
    assert.equal(out.other, "");
  });

  it("--exec passes env vars to child process", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "workspace");
    const scripts = join(ws, "scripts");
    const child = join(tmp.dir, "print-env.mjs");
    writeFileSync(join(tmp.dir, ".env.local"), "TEST_MCP_SECRET=from-file\n");
    writeFileSync(child, `console.log(process.env.TEST_MCP_SECRET || "");\n`);
    mkdirSync(scripts, { recursive: true });
    cpSync(join(REAL, "..", "scripts", "lib.mjs"), join(scripts, "lib.mjs"));
    cpSync(SCRIPT, join(scripts, "mcp-load-env.mjs"));

    const r = spawnSync(process.execPath, [
      join(scripts, "mcp-load-env.mjs"), "--exec", "--", process.execPath, child,
    ], { cwd: ws, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "from-file");
  });
});
