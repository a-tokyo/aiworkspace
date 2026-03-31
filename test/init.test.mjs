import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir, runScript } from "./helpers.mjs";

const INIT_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "aiworkspace.mjs");

let tmp;
afterEach(() => tmp?.cleanup());

describe("aiworkspace init", () => {
  it("creates correct directory structure", () => {
    tmp = makeTmpDir();
    const { exitCode } = runScript(INIT_SCRIPT, ["init", "--no-install"], { cwd: tmp.dir });
    assert.equal(exitCode, 0);

    const ws = join(tmp.dir, "workspace");
    assert.ok(existsSync(join(ws, "scripts", "lib.mjs")));
    assert.ok(existsSync(join(ws, "scripts", "skills", "setup-skills.mjs")));
    assert.ok(existsSync(join(ws, "root-config", "AGENTS.md")));
    assert.ok(existsSync(join(ws, "root-config", ".agents", "skills")));
    assert.ok(existsSync(join(ws, ".agents", "skills")));
    assert.ok(!existsSync(join(ws, "LICENSE")));
    assert.ok(existsSync(join(ws, ".gitignore")));
    assert.ok(existsSync(join(ws, "package.json")));
    assert.ok(existsSync(join(ws, "local", ".gitkeep")));
  });

  it("derives consumer package.json correctly", () => {
    tmp = makeTmpDir();
    runScript(INIT_SCRIPT, ["init", "--no-install"], { cwd: tmp.dir });

    const pkg = JSON.parse(readFileSync(join(tmp.dir, "workspace", "package.json"), "utf8"));
    assert.equal(pkg.private, true);
    assert.equal(pkg.bin, undefined);
    assert.equal(pkg.files, undefined);
    assert.equal(pkg.license, undefined);
    assert.equal(pkg.author, undefined);
    assert.equal(pkg.repository, undefined);
    assert.equal(pkg.type, "module");
    assert.ok(pkg.engines?.node);
    assert.equal(pkg.scripts.test, undefined);
    assert.equal(pkg.scripts.lint, undefined);
    assert.equal(pkg.scripts.postinstall, "node scripts/postinstall.mjs");
    assert.ok(pkg.scripts.upgrade);
    assert.ok(pkg.scripts["skills:setup"]);
  });

  it("upgrade script references node wrapper", () => {
    tmp = makeTmpDir();
    runScript(INIT_SCRIPT, ["init", "--no-install"], { cwd: tmp.dir });

    const pkg = JSON.parse(readFileSync(join(tmp.dir, "workspace", "package.json"), "utf8"));
    assert.equal(pkg.scripts.upgrade, "node scripts/upgrade.mjs");
    assert.ok(existsSync(join(tmp.dir, "workspace", "scripts", "upgrade.mjs")));
  });

  it("sets up git with upstream remote", () => {
    tmp = makeTmpDir();
    runScript(INIT_SCRIPT, ["init", "--no-install"], { cwd: tmp.dir });

    const ws = join(tmp.dir, "workspace");
    assert.ok(existsSync(join(ws, ".git")));

    const result = spawnSync("git", ["remote", "-v"], { cwd: ws, encoding: "utf8" });
    assert.ok(result.stdout.includes("upstream"));
    assert.ok(result.stdout.includes("aiworkspace"));
  });

  it("supports custom name", () => {
    tmp = makeTmpDir();
    const { exitCode } = runScript(INIT_SCRIPT, ["init", "my-ws", "--no-install"], { cwd: tmp.dir });
    assert.equal(exitCode, 0);
    assert.ok(existsSync(join(tmp.dir, "my-ws", "package.json")));
    assert.ok(!existsSync(join(tmp.dir, "workspace")));
  });

  it("refuses existing directory", () => {
    tmp = makeTmpDir();
    runScript(INIT_SCRIPT, ["init", "--no-install"], { cwd: tmp.dir });
    const { exitCode } = runScript(INIT_SCRIPT, ["init", "--no-install"], { cwd: tmp.dir });
    assert.notEqual(exitCode, 0);
  });

  it("--version prints version and exits 0", () => {
    tmp = makeTmpDir();
    const { stdout, exitCode } = runScript(INIT_SCRIPT, ["--version"]);
    assert.equal(exitCode, 0);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  it("--help exits 0", () => {
    tmp = makeTmpDir();
    const { stdout, exitCode } = runScript(INIT_SCRIPT, ["--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("aiworkspace"));
  });

  it("rewrites doc paths for custom name", () => {
    tmp = makeTmpDir();
    runScript(INIT_SCRIPT, ["init", "my-ws", "--no-install"], { cwd: tmp.dir });
    const setup = readFileSync(join(tmp.dir, "my-ws", "setup.md"), "utf8");
    assert.ok(setup.includes("my-ws/"));
    assert.ok(!setup.includes("workspace/"));
  });

  it("creates root-config/skills-lock.json", () => {
    tmp = makeTmpDir();
    runScript(INIT_SCRIPT, ["init", "--no-install"], { cwd: tmp.dir });
    const lockfile = join(tmp.dir, "workspace", "root-config", "skills-lock.json");
    assert.ok(existsSync(lockfile));
    const lock = JSON.parse(readFileSync(lockfile, "utf8"));
    assert.equal(lock.version, 1);
    assert.deepEqual(lock.skills, {});
  });

  it("rejects invalid names", () => {
    tmp = makeTmpDir();
    for (const bad of ["has space", ".dotstart", "node_modules", ".git"]) {
      const { exitCode } = runScript(INIT_SCRIPT, ["init", bad], { cwd: tmp.dir });
      assert.notEqual(exitCode, 0, `should reject: ${bad}`);
    }
  });

  it("supports --name flag", () => {
    tmp = makeTmpDir();
    const { exitCode } = runScript(INIT_SCRIPT, ["init", "--name", "my-ws", "--no-install"], { cwd: tmp.dir });
    assert.equal(exitCode, 0);
    assert.ok(existsSync(join(tmp.dir, "my-ws", "package.json")));
  });

  it("rejects --name without value", () => {
    tmp = makeTmpDir();
    const { exitCode, stderr } = runScript(INIT_SCRIPT, ["init", "--name"], { cwd: tmp.dir });
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.includes("--name requires a value"));
  });

  it("rejects --name followed by another flag", () => {
    tmp = makeTmpDir();
    const { exitCode, stderr } = runScript(INIT_SCRIPT, ["init", "--name", "--foo"], { cwd: tmp.dir });
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.includes("--name requires a value"));
  });

  it("unknown command exits with error", () => {
    tmp = makeTmpDir();
    const { exitCode, stderr } = runScript(INIT_SCRIPT, ["foobar"], { cwd: tmp.dir });
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.includes("Unknown command"));
  });

  it("--no-install skips npm install", () => {
    tmp = makeTmpDir();
    const { stdout } = runScript(INIT_SCRIPT, ["init", "--no-install"], { cwd: tmp.dir });
    assert.ok(!stdout.includes("Installing dependencies"));
    assert.ok(!existsSync(join(tmp.dir, "workspace", "node_modules")));
  });

  it("runs npm install by default", () => {
    tmp = makeTmpDir();
    const binDir = join(tmp.dir, "fake-bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "npm"), "#!/bin/sh\necho 'mock-npm-ran'\n", { mode: 0o755 });
    const { stdout } = runScript(INIT_SCRIPT, ["init"], {
      cwd: tmp.dir,
      env: { PATH: `${binDir}:${process.env.PATH}` },
    });
    assert.ok(stdout.includes("Installing dependencies"));
  });

  it("--no-install works with custom name", () => {
    tmp = makeTmpDir();
    const { exitCode } = runScript(INIT_SCRIPT, ["init", "my-ws", "--no-install"], { cwd: tmp.dir });
    assert.equal(exitCode, 0);
    assert.ok(existsSync(join(tmp.dir, "my-ws", "package.json")));
    assert.ok(!existsSync(join(tmp.dir, "my-ws", "node_modules")));
  });
});
