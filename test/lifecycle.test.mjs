import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";

let tmp;
afterEach(() => tmp?.cleanup());

const createScript = (ws) => join(ws, "scripts", "skills", "create-skill.mjs");
const setupScript = (ws) => join(ws, "scripts", "skills", "setup-skills.mjs");

describe("skill lifecycle", () => {
  it("create workspace-wide → setup → verify symlinks → remove → verify cleanup", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir);

    // Create workspace-wide skill
    let r = runScript(createScript(ws), ["--name", "test-skill", "--no-setup"], { cwd: ws });
    assert.equal(r.exitCode, 0);
    assert.ok(existsSync(join(ws, "root-config", ".agents", "skills", "test-skill", "SKILL.md")));

    // Run setup
    r = runScript(setupScript(ws), [], { cwd: ws });
    assert.equal(r.exitCode, 0);

    // Verify symlinks at parent root
    for (const sub of [".claude/skills/test-skill", "skills/test-skill"]) {
      const p = join(tmp.dir, sub);
      assert.ok(existsSync(p), `missing ${sub}`);
      assert.ok(lstatSync(p).isSymbolicLink(), `not symlink: ${sub}`);
    }

    // Remove skill and re-run setup
    rmSync(join(ws, "root-config", ".agents", "skills", "test-skill"), { recursive: true });
    r = runScript(setupScript(ws), [], { cwd: ws });
    assert.equal(r.exitCode, 0);

    // Verify symlinks removed
    for (const sub of [".claude/skills/test-skill", "skills/test-skill"]) {
      assert.ok(!existsSync(join(tmp.dir, sub)), `stale ${sub} not cleaned`);
    }
  });

  it("create project-specific skill → setup → verify isolation", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, {
      withSkill: "ws-wide",
      withProject: { name: "my-app" },
    });

    // Create project skill
    let r = runScript(createScript(ws), [
      "--name", "proj-skill", "--project", "my-app", "--no-setup",
    ], { cwd: ws });
    assert.equal(r.exitCode, 0);

    // Run setup
    r = runScript(setupScript(ws), [], { cwd: ws });
    assert.equal(r.exitCode, 0);

    // Project skill symlinks exist in project
    assert.ok(existsSync(join(tmp.dir, "my-app", ".claude", "skills", "proj-skill")));

    // Project skill does NOT appear at parent root
    assert.ok(!existsSync(join(tmp.dir, ".claude", "skills", "proj-skill")));

    // Workspace-wide skill does NOT appear in project
    assert.ok(!existsSync(join(tmp.dir, "my-app", ".claude", "skills", "ws-wide")));
  });

  it("--clean tears down everything", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, {
      withSkill: "demo",
      withProject: { name: "my-app", skill: "app-skill" },
    });

    // Setup then clean
    runScript(setupScript(ws), [], { cwd: ws });
    assert.ok(existsSync(join(tmp.dir, "AGENTS.md")));
    assert.ok(existsSync(join(tmp.dir, ".claude", "skills", "demo")));

    runScript(setupScript(ws), ["--clean"], { cwd: ws });

    // All mirrored items gone
    assert.ok(!existsSync(join(tmp.dir, "AGENTS.md")));
    assert.ok(!existsSync(join(tmp.dir, ".claude", "skills", "demo")));
    assert.ok(!existsSync(join(tmp.dir, "my-app", ".claude", "skills", "app-skill")));
  });
});
