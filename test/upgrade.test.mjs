import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, unlinkSync, writeFileSync, existsSync, chmodSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";

const REAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("upgrade (npm path)", () => {
  let tmp;
  afterEach(() => tmp?.cleanup());

  function makeConsumer({ devDep = true, gitInit = false } = {}) {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "consumer");
    const binDir = join(tmp.dir, "fake-bin");
    mkdirSync(ws, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    cpSync(join(REAL, "scripts"), join(ws, "scripts"), { recursive: true });

    const nmAiws = join(ws, "node_modules", "aiworkspace");
    mkdirSync(join(nmAiws, "scripts"), { recursive: true });
    cpSync(join(REAL, "scripts"), join(nmAiws, "scripts"), { recursive: true });
    writeFileSync(
      join(nmAiws, "package.json"),
      JSON.stringify({ name: "aiworkspace", version: "9.9.9-test" }) + "\n",
    );

    const pkgJson = { name: "consumer-ws", private: true };
    if (devDep) pkgJson.devDependencies = { aiworkspace: "^0.1.0" };
    writeFileSync(join(ws, "package.json"), JSON.stringify(pkgJson) + "\n");

    const isWin = process.platform === "win32";
    const npmSh = join(binDir, isWin ? "npm.cmd" : "npm");
    if (isWin) {
      writeFileSync(npmSh, "@echo off\nexit /b 0\n");
    } else {
      writeFileSync(npmSh, "#!/bin/sh\nexit 0\n");
      chmodSync(npmSh, 0o755);
    }

    if (gitInit) {
      const git = (...args) => execFileSync("git", args, { cwd: ws, stdio: "ignore" });
      git("init");
      git("config", "user.email", "test@test.local");
      git("config", "user.name", "Test");
      git("add", "-A");
      git("commit", "-m", "initial");
    }

    return { ws, binDir };
  }

  function runUpgrade(ws, binDir) {
    const isWin = process.platform === "win32";
    return spawnSync(process.execPath, [join("scripts", "upgrade.mjs")], {
      cwd: ws,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}${isWin ? ";" : ":"}${process.env.PATH}` },
    });
  }

  it("copies scripts from node_modules/aiworkspace after npm update", () => {
    const { ws, binDir } = makeConsumer();

    unlinkSync(join(ws, "scripts", "postinstall.mjs"));
    assert.ok(!existsSync(join(ws, "scripts", "postinstall.mjs")));

    const r = runUpgrade(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(join(ws, "scripts", "postinstall.mjs")), "postinstall.mjs should be restored");
    assert.ok(r.stdout.includes("9.9.9-test"), `should log version, got: ${r.stdout}`);
    assert.ok(r.stdout.includes("(npm)"), `should indicate npm path, got: ${r.stdout}`);
  });

  it("stages scripts/ after npm copy in a git repo", () => {
    const { ws, binDir } = makeConsumer({ gitInit: true });

    writeFileSync(
      join(ws, "node_modules", "aiworkspace", "scripts", "postinstall.mjs"),
      "// upgraded\n",
    );

    const r = runUpgrade(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(r.stdout.includes("git diff --cached"), "should suggest git diff --cached in git repo");

    const diff = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: ws, encoding: "utf8" });
    assert.ok(diff.stdout.includes("scripts/postinstall.mjs"), "postinstall.mjs should be staged");
  });

  it("removes stale scripts not present in newer version", () => {
    const { ws, binDir } = makeConsumer();

    writeFileSync(join(ws, "scripts", "old-removed-script.mjs"), "// stale\n");
    assert.ok(existsSync(join(ws, "scripts", "old-removed-script.mjs")));

    const r = runUpgrade(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(!existsSync(join(ws, "scripts", "old-removed-script.mjs")), "stale script should be removed");
    assert.ok(existsSync(join(ws, "scripts", "lib.mjs")), "current scripts should still exist");
  });

  it("does not mention git diff when not a git repo", () => {
    const { ws, binDir } = makeConsumer({ gitInit: false });

    const r = runUpgrade(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(!r.stdout.includes("git diff"), `should not mention git diff, got: ${r.stdout}`);
  });

  it("cleans up temp dirs after successful upgrade", () => {
    const { ws, binDir } = makeConsumer();

    const r = runUpgrade(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(!existsSync(join(ws, "scripts.upgrade-tmp")), "temp dir should be cleaned up");
    assert.ok(!existsSync(join(ws, "scripts.upgrade-backup")), "backup dir should be cleaned up");
  });
});
