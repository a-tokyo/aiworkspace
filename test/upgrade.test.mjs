import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, unlinkSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";

const REAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";

function runUpgradeScript(ws, binDir) {
  return spawnSync(process.execPath, [join("scripts", "upgrade.mjs")], {
    cwd: ws,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}${IS_WIN ? ";" : ":"}${process.env.PATH}` },
  });
}

function createConsumer(parentDir, {
  devDep = true,
  gitInit = false,
  upstreamBare = null,
  npmExitCode = 0,
} = {}) {
  const ws = join(parentDir, "consumer");
  const binDir = join(parentDir, "fake-bin");
  mkdirSync(ws, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  cpSync(join(REAL, "scripts"), join(ws, "scripts"), { recursive: true });

  if (devDep) {
    const nmAiws = join(ws, "node_modules", "aiworkspace");
    mkdirSync(join(nmAiws, "scripts"), { recursive: true });
    cpSync(join(REAL, "scripts"), join(nmAiws, "scripts"), { recursive: true });
    writeFileSync(
      join(nmAiws, "package.json"),
      JSON.stringify({ name: "aiworkspace", version: "9.9.9-test" }) + "\n",
    );
  }

  const pkgJson = { name: "consumer-ws", private: true };
  if (devDep) pkgJson.devDependencies = { aiworkspace: "^0.1.0" };
  writeFileSync(join(ws, "package.json"), JSON.stringify(pkgJson) + "\n");

  const npmSh = join(binDir, IS_WIN ? "npm.cmd" : "npm");
  if (IS_WIN) {
    writeFileSync(npmSh, `@echo off\nexit /b ${npmExitCode}\n`);
  } else {
    writeFileSync(npmSh, `#!/bin/sh\nexit ${npmExitCode}\n`);
    chmodSync(npmSh, 0o755);
  }

  if (gitInit) {
    const git = (...a) => execFileSync("git", a, { cwd: ws, stdio: "ignore" });
    git("init");
    git("config", "user.email", "test@test.local");
    git("config", "user.name", "Test");
    git("add", "-A");
    git("commit", "-m", "initial");
    if (upstreamBare) git("remote", "add", "upstream", upstreamBare);
  }

  return { ws, binDir };
}

function seedBareUpstream(parentDir) {
  const work = join(parentDir, "upstream-work");
  const bare = resolve(join(parentDir, "upstream.git"));
  mkdirSync(work, { recursive: true });
  cpSync(join(REAL, "scripts"), join(work, "scripts"), { recursive: true });
  writeFileSync(
    join(work, "package.json"),
    `${JSON.stringify({ name: "aiworkspace", version: "2.0.0-gitfixture" })}\n`,
  );
  const gw = (...a) => execFileSync("git", a, { cwd: work, stdio: "ignore" });
  gw("init");
  gw("config", "user.email", "u@t");
  gw("config", "user.name", "U");
  gw("add", "-A");
  gw("commit", "-m", "init");
  gw("branch", "-M", "main");
  execFileSync("git", ["init", "--bare", bare], { stdio: "ignore" });
  gw("remote", "add", "origin", bare);
  gw("push", "-u", "origin", "main");
  return bare;
}

// -- npm path tests -----------------------------------------------------------

describe("upgrade (npm path)", () => {
  let tmp;
  afterEach(() => tmp?.cleanup());

  function make(opts) {
    tmp = makeTmpDir();
    return createConsumer(tmp.dir, opts);
  }

  it("copies scripts from node_modules/aiworkspace after npm update", () => {
    const { ws, binDir } = make();

    unlinkSync(join(ws, "scripts", "postinstall.mjs"));
    assert.ok(!existsSync(join(ws, "scripts", "postinstall.mjs")));

    const r = runUpgradeScript(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(join(ws, "scripts", "postinstall.mjs")), "postinstall.mjs should be restored");
    assert.ok(r.stdout.includes("9.9.9-test"), `should log version, got: ${r.stdout}`);
    assert.ok(r.stdout.includes("(npm)"), `should indicate npm path, got: ${r.stdout}`);
    assert.ok(!existsSync(`${join(ws, "scripts")}.upgrade-tmp`), "temp dir should be cleaned up");
    assert.ok(!existsSync(`${join(ws, "scripts")}.upgrade-backup`), "backup dir should be cleaned up");
  });

  it("stages scripts/, package.json, and package-lock.json in a git repo", () => {
    const { ws, binDir } = make({ gitInit: true });

    writeFileSync(
      join(ws, "node_modules", "aiworkspace", "scripts", "postinstall.mjs"),
      "// upgraded\n",
    );
    writeFileSync(
      join(ws, "package.json"),
      JSON.stringify({ name: "consumer-ws", private: true, devDependencies: { aiworkspace: "^0.1.3" } }) + "\n",
    );
    writeFileSync(join(ws, "package-lock.json"), "{}\n");

    const r = runUpgradeScript(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(r.stdout.includes("git diff --cached"), "should suggest git diff --cached");

    const diff = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: ws, encoding: "utf8" });
    assert.ok(diff.stdout.includes("scripts/postinstall.mjs"), "postinstall.mjs should be staged");
    assert.ok(diff.stdout.includes("package.json"), "package.json should be staged");
    assert.ok(diff.stdout.includes("package-lock.json"), "package-lock.json should be staged");
  });

  it("removes stale scripts not present in newer version", () => {
    const { ws, binDir } = make();

    writeFileSync(join(ws, "scripts", "old-removed-script.mjs"), "// stale\n");
    assert.ok(existsSync(join(ws, "scripts", "old-removed-script.mjs")));

    const r = runUpgradeScript(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(!existsSync(join(ws, "scripts", "old-removed-script.mjs")), "stale script should be removed");
    assert.ok(existsSync(join(ws, "scripts", "lib.mjs")), "current scripts should still exist");
  });

  it("does not mention git diff when not a git repo", () => {
    const { ws, binDir } = make({ gitInit: false });

    const r = runUpgradeScript(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(!r.stdout.includes("git diff"), `should not mention git diff, got: ${r.stdout}`);
  });

  it("aborts when npm is interrupted by a signal", () => {
    if (IS_WIN) return;
    const { ws, binDir } = make();
    writeFileSync(join(binDir, "npm"), "#!/bin/sh\nkill -TERM $$\n");
    chmodSync(join(binDir, "npm"), 0o755);

    const r = runUpgradeScript(ws, binDir);
    assert.notEqual(r.status, 0, "should exit non-zero on signal");
    assert.ok(r.stderr.includes("interrupted"), `expected interrupted error, got: ${r.stderr}`);
  });
});

// -- git path + npm fallback tests --------------------------------------------

describe("upgrade (git path and npm fallback)", () => {
  let tmp;
  afterEach(() => tmp?.cleanup());

  it("uses git upstream when aiworkspace is not an npm dependency", () => {
    tmp = makeTmpDir();
    const bare = seedBareUpstream(tmp.dir);
    const { ws, binDir } = createConsumer(tmp.dir, { devDep: false, gitInit: true, upstreamBare: bare });

    const r = runUpgradeScript(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(r.stdout.includes("(git upstream)"), `expected git path, got: ${r.stdout}`);
    assert.ok(r.stdout.includes("2.0.0-gitfixture"), `expected upstream version, got: ${r.stdout}`);
  });

  it("falls back to git upstream when npm update fails", () => {
    tmp = makeTmpDir();
    const bare = seedBareUpstream(tmp.dir);
    const { ws, binDir } = createConsumer(tmp.dir, {
      gitInit: true, upstreamBare: bare, npmExitCode: 1,
    });

    const r = runUpgradeScript(ws, binDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(
      r.stderr.includes("npm upgrade failed") || r.stdout.includes("npm upgrade failed"),
      `expected fallback warning, stdout=${r.stdout} stderr=${r.stderr}`,
    );
    assert.ok(r.stdout.includes("(git upstream)"), `expected git path after fallback, got: ${r.stdout}`);
    assert.ok(r.stdout.includes("2.0.0-gitfixture"), `expected upstream version, got: ${r.stdout}`);
  });
});
