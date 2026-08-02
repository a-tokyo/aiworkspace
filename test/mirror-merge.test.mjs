import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";

let tmp;
afterEach(() => tmp?.cleanup());

const setupScript = (ws) => join(ws, "scripts", "skills", "setup-skills.mjs");
const CONFLICT_WARNING = "resolve manually or remove it";

/** Skill directories a third-party tool (e.g. `openspec init`) writes into root-config/. */
const TOOL_SKILLS = ["openspec-apply", "openspec-archive", "openspec-proposal"];

function writeToolSkills(ws) {
  for (const name of TOOL_SKILLS) {
    const dir = join(ws, "root-config", ".claude", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n`);
  }
}

describe("setup-skills L2 mirror merge", () => {
  it("merges tool-written skills into the parent's real .claude/skills dir", () => {
    // Setup itself creates the parent's .claude/skills as a real directory to
    // hold per-skill symlinks, so a tool writing into root-config/.claude/skills
    // afterwards lands on a real-dir destination.
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), [], { cwd: ws });

    const parentSkills = join(tmp.dir, ".claude", "skills");
    const st = lstatSync(parentSkills);
    assert.ok(st.isDirectory() && !st.isSymbolicLink(), "parent .claude/skills should be a real dir");

    writeToolSkills(ws);
    const { stderr } = runScript(setupScript(ws), [], { cwd: ws });

    assert.ok(!stderr.includes(CONFLICT_WARNING), `should not warn on merge, got: ${stderr}`);
    for (const name of TOOL_SKILLS) {
      const link = join(parentSkills, name);
      assert.ok(existsSync(link), `missing merged ${name}`);
      assert.ok(lstatSync(link).isSymbolicLink(), `${name} should be a symlink`);
      assert.equal(readFileSync(join(link, "SKILL.md"), "utf8"), `---\nname: ${name}\n---\n`);
    }
    assert.ok(existsSync(join(parentSkills, "demo")), "canonical skill link should survive the merge");
  });

  it("still warns and skips when the destination is a real dir but the source is not", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    mkdirSync(join(ws, "root-config", ".vscode"), { recursive: true });
    writeFileSync(join(ws, "root-config", ".vscode", "mcp.json"), '{"servers":{}}\n');
    const dest = join(tmp.dir, ".vscode", "mcp.json");
    mkdirSync(dest, { recursive: true });

    const { stderr } = runScript(setupScript(ws), [], { cwd: ws });

    assert.ok(stderr.includes(".vscode/mcp.json"), `should name the conflicting path, got: ${stderr}`);
    assert.ok(stderr.includes(CONFLICT_WARNING), `should warn on genuine conflict, got: ${stderr}`);
    const st = lstatSync(dest);
    assert.ok(st.isDirectory() && !st.isSymbolicLink(), "conflicting real dir should be left untouched");
  });

  it("is idempotent across repeated merges", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), [], { cwd: ws });
    writeToolSkills(ws);

    const expected = [...TOOL_SKILLS, "demo"].sort();
    const parentSkills = join(tmp.dir, ".claude", "skills");

    for (const pass of [1, 2, 3]) {
      const { stdout, stderr, exitCode } = runScript(setupScript(ws), [], { cwd: ws });
      const output = stdout + stderr;
      assert.equal(exitCode, 0, `pass ${pass} failed: ${output}`);
      if (pass > 1) {
        assert.ok(!stderr.includes(CONFLICT_WARNING), `pass ${pass} warned: ${stderr}`);
        assert.ok(!output.includes("Removed stale"), `pass ${pass} removed a live link: ${output}`);
      }
      assert.deepEqual(readdirSync(parentSkills).sort(), expected, `pass ${pass} link set drifted`);
      for (const name of expected) {
        assert.ok(lstatSync(join(parentSkills, name)).isSymbolicLink(), `${name} should stay a symlink`);
      }
    }
  });
});

describe("setup-skills invisible directory warning", () => {
  it("warns when an empty directory is skipped by the mirror", () => {
    // Git cannot see an empty directory, so `openspec init`'s empty
    // openspec/specs/ and openspec/changes/ mirrored as nothing while
    // openspec/ itself looked correct at the parent root. Note the uncommitted
    // sibling below still mirrors — being untracked is not what blocks it.
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const git = (...a) => execFileSync("git", a, { cwd: ws, stdio: "ignore" });
    git("init");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("add", "-A");
    git("commit", "-m", "init");

    mkdirSync(join(ws, "root-config", "openspec", "specs"), { recursive: true });
    writeFileSync(join(ws, "root-config", "openspec", "project.md"), "# project\n");

    const { stderr } = runScript(setupScript(ws), [], { cwd: ws });

    assert.ok(
      stderr.includes(join("root-config", "openspec", "specs")),
      `should name the unmirrorable directory, got: ${stderr}`,
    );
    assert.ok(stderr.includes(".gitkeep"), `should say how to fix it, got: ${stderr}`);
    assert.ok(!existsSync(join(tmp.dir, "openspec", "specs")), "empty dir should still not mirror");
    assert.ok(
      existsSync(join(tmp.dir, "openspec", "project.md")),
      "untracked-but-not-ignored sibling should still mirror",
    );
  });

  it("does not warn about files git cannot see", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const git = (...a) => execFileSync("git", a, { cwd: ws, stdio: "ignore" });
    git("init");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("add", "-A");
    git("commit", "-m", "init");
    writeFileSync(join(ws, "root-config", ".gitignore"), "ignored.md\n");
    writeFileSync(join(ws, "root-config", "ignored.md"), "# ignored\n");

    const { stderr } = runScript(setupScript(ws), [], { cwd: ws });

    assert.ok(!stderr.includes("ignored.md"), `should stay quiet about files, got: ${stderr}`);
  });
});
