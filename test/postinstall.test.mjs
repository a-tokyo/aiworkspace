import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";

const REAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("postinstall", () => {
  let tmp;
  afterEach(() => tmp?.cleanup());

  it("exits 0 immediately when running inside node_modules", () => {
    tmp = makeTmpDir();
    const fakeNm = join(tmp.dir, "project", "node_modules", "aiworkspace");
    mkdirSync(join(fakeNm, "scripts"), { recursive: true });
    cpSync(join(REAL, "scripts", "postinstall.mjs"), join(fakeNm, "scripts", "postinstall.mjs"));
    cpSync(join(REAL, "scripts", "lib.mjs"), join(fakeNm, "scripts", "lib.mjs"));

    const r = spawnSync(process.execPath, ["scripts/postinstall.mjs"], {
      cwd: fakeNm,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });
});
