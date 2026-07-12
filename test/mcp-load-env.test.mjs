import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";
import { parseDotenv, loadEnvLocal, buildChildEnv } from "../scripts/mcp-load-env.mjs";

const REAL = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(REAL, "..", "scripts", "mcp-load-env.mjs");

let tmp;
afterEach(() => tmp?.cleanup());

describe("mcp-load-env", () => {
  it("parseDotenv handles export prefixes, inline comments and escapes", () => {
    const out = parseDotenv([
      "export EXPORTED=from-profile",
      'QUOTED="tok" # trailing note',
      "BARE=plain # trailing note",
      "HASH=p@ss#word",
      'ESCAPED="line1\\nline2"',
      "EQUALS=a=b=c",
      "SPACED = spaced",
    ].join("\n"));

    assert.equal(out.EXPORTED, "from-profile", "export prefix must be stripped");
    assert.equal(out.QUOTED, "tok", "quotes and inline comment must be stripped");
    assert.equal(out.BARE, "plain", "inline comment must be stripped");
    assert.equal(out.HASH, "p@ss#word", "a # inside a value is not a comment");
    assert.equal(out.ESCAPED, "line1\nline2");
    assert.equal(out.EQUALS, "a=b=c");
    assert.equal(out.SPACED, "spaced");
    assert.equal(out["export EXPORTED"], undefined);
  });

  it("parseDotenv skips comments and parses quoted values", () => {
    const out = parseDotenv(`
# comment
FOO=bar
BAZ="quoted"
`);
    assert.equal(out.FOO, "bar");
    assert.equal(out.BAZ, "quoted");
  });

  it("loadEnvLocal parses values from a file path", () => {
    tmp = makeTmpDir();
    const envPath = join(tmp.dir, ".env.local");
    writeFileSync(envPath, "MY_API_KEY=secret\n");
    const out = loadEnvLocal(envPath);
    assert.equal(out.MY_API_KEY, "secret");
  });

  it("--headers prints JSON authorization header", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "workspace");
    mkdirSync(join(ws, "scripts"), { recursive: true });
    cpSync(SCRIPT, join(ws, "scripts", "mcp-load-env.mjs"));
    writeFileSync(join(tmp.dir, ".env.local"), "MY_API_KEY=secret-token\n");
    const r = spawnSync(process.execPath, [
      join(ws, "scripts", "mcp-load-env.mjs"),
      "--headers", "Authorization",
      "--var", "MY_API_KEY",
      "--prefix", "Bearer ",
    ], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { Authorization: "Bearer secret-token" });
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

  it("--map remaps child env keys from source vars", () => {
    const env = buildChildEnv({ MY_API_KEY: "secret" }, { only: ["MY_API_KEY"], maps: ["API_KEY:MY_API_KEY"] });
    assert.equal(env.MY_API_KEY, "secret");
    assert.equal(env.API_KEY, "secret");
  });

  it("--exec passes --only env vars to child process", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "workspace");
    const scripts = join(ws, "scripts");
    const child = join(tmp.dir, "print-env.mjs");
    writeFileSync(join(tmp.dir, ".env.local"), "TEST_MCP_SECRET=from-file\n");
    writeFileSync(child, `console.log(process.env.TEST_MCP_SECRET || "");\n`);
    mkdirSync(scripts, { recursive: true });
    cpSync(SCRIPT, join(scripts, "mcp-load-env.mjs"));

    const r = spawnSync(process.execPath, [
      join(scripts, "mcp-load-env.mjs"),
      "--only", "TEST_MCP_SECRET", "--exec", "--", process.execPath, child,
    ], { cwd: ws, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "from-file");
  });

  it("--exec without --only passes no .env.local vars to the child", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "workspace");
    const scripts = join(ws, "scripts");
    const child = join(tmp.dir, "print-env.mjs");
    writeFileSync(join(tmp.dir, ".env.local"), "TEST_MCP_SECRET=from-file\nOTHER_SECRET=nope\n");
    writeFileSync(child, `console.log(process.env.TEST_MCP_SECRET || "none");\n`);
    mkdirSync(scripts, { recursive: true });
    cpSync(SCRIPT, join(scripts, "mcp-load-env.mjs"));

    // Default-deny: handing the child every secret in .env.local is not the fallback.
    const r = spawnSync(process.execPath, [
      join(scripts, "mcp-load-env.mjs"), "--exec", "--", process.execPath, child,
    ], { cwd: ws, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "none");
  });

  it("--exec expands ${VAR} placeholders in child args", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "workspace");
    const scripts = join(ws, "scripts");
    const child = join(tmp.dir, "print-arg.mjs");
    writeFileSync(join(tmp.dir, ".env.local"), "FOO_TOKEN=tok-123\n");
    writeFileSync(child, `console.log(process.argv[2] || "");\n`);
    mkdirSync(scripts, { recursive: true });
    cpSync(SCRIPT, join(scripts, "mcp-load-env.mjs"));

    // The child used to receive the literal string "${FOO_TOKEN}" as its API key.
    const r = spawnSync(process.execPath, [
      join(scripts, "mcp-load-env.mjs"),
      "--only", "FOO_TOKEN", "--exec", "--", process.execPath, child, "${FOO_TOKEN}",
    ], { cwd: ws, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "tok-123");
  });
});
