import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";

let tmp;
afterEach(() => tmp?.cleanup());

const createScript = (ws) => join(ws, "scripts", "skills", "create-skill.mjs");

describe("create-skill", () => {
  it("creates SKILL.md in root-config", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir);
    const { exitCode } = runScript(createScript(ws), ["--name", "my-skill", "--no-setup"], { cwd: ws });
    assert.equal(exitCode, 0);

    const skillFile = join(ws, "root-config", ".agents", "skills", "my-skill", "SKILL.md");
    assert.ok(existsSync(skillFile));

    const content = readFileSync(skillFile, "utf8");
    assert.ok(content.includes("name: my-skill"));
    assert.ok(content.includes("# My Skill"));
  });

  it("rejects invalid names", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir);

    for (const bad of ["UPPER", "has space", "special!", "-leading", "trailing-", ".leading-dot", "trailing."]) {
      const { exitCode } = runScript(createScript(ws), ["--name", bad, "--no-setup"], { cwd: ws });
      assert.notEqual(exitCode, 0, `should reject: ${bad}`);
    }
  });

  it("accepts valid names", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir);

    for (const good of ["a", "my-skill", "s3", "a-b-c", "with_underscore", "with.dot", "mix-of_all.three"]) {
      const { exitCode } = runScript(createScript(ws), ["--name", good, "--no-setup"], { cwd: ws });
      assert.equal(exitCode, 0, `should accept: ${good}`);
    }
  });

  it("--project routes to project dir", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, {
      withProject: { name: "my-app" },
    });
    const { exitCode } = runScript(createScript(ws), ["--name", "proj-skill", "--project", "my-app", "--no-setup"], { cwd: ws });
    assert.equal(exitCode, 0);

    const skillFile = join(tmp.dir, "my-app", ".agents", "skills", "proj-skill", "SKILL.md");
    assert.ok(existsSync(skillFile));
  });

  it("--project with subdirectory routes to nested project dir", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, {
      withProject: { name: "website/backend" },
    });
    const { exitCode } = runScript(createScript(ws), ["--name", "nested-skill", "--project", "website/backend", "--no-setup"], { cwd: ws });
    assert.equal(exitCode, 0);

    const skillFile = join(tmp.dir, "website", "backend", ".agents", "skills", "nested-skill", "SKILL.md");
    assert.ok(existsSync(skillFile));
  });

  it("refuses duplicate skill", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "existing" });
    const { exitCode } = runScript(createScript(ws), ["--name", "existing", "--no-setup"], { cwd: ws });
    assert.notEqual(exitCode, 0);
  });

  it("errors without --name", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir);
    const { exitCode } = runScript(createScript(ws), ["--no-setup"], { cwd: ws });
    assert.notEqual(exitCode, 0);
  });
});
