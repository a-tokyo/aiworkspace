import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, unlinkSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";

const REAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("upgrade (npm path)", () => {
  let tmp;
  afterEach(() => tmp?.cleanup());

  it("copies scripts from node_modules/aiworkspace after npm update", () => {
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
      JSON.stringify({ name: "aiworkspace", version: "9.9.9-test" }, null, 2) + "\n",
    );

    writeFileSync(
      join(ws, "package.json"),
      JSON.stringify(
        {
          name: "consumer-ws",
          private: true,
          devDependencies: {
            aiworkspace: "^0.1.0",
          },
        },
        null,
        2,
      ) + "\n",
    );

    const isWin = process.platform === "win32";
    const npmSh = join(binDir, isWin ? "npm.cmd" : "npm");
    if (isWin) {
      writeFileSync(npmSh, "@echo off\nexit /b 0\n");
    } else {
      writeFileSync(npmSh, "#!/bin/sh\nexit 0\n");
      chmodSync(npmSh, 0o755);
    }

    unlinkSync(join(ws, "scripts", "postinstall.mjs"));
    assert.ok(!existsSync(join(ws, "scripts", "postinstall.mjs")));

    const up = spawnSync(process.execPath, [join("scripts", "upgrade.mjs")], {
      cwd: ws,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}${isWin ? ";" : ":"}${process.env.PATH}` },
    });
    assert.equal(up.status, 0, up.stderr + up.stdout);
    assert.ok(existsSync(join(ws, "scripts", "postinstall.mjs")), "postinstall.mjs restored from node_modules copy");
    assert.ok(up.stdout.includes("9.9.9-test") || up.stdout.includes("npm"), up.stdout);
  });
});
