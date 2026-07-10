import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, lstatSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";
import { validateLockFile } from "../scripts/lib.mjs";

let tmp;
afterEach(() => tmp?.cleanup());

const setupScript = (ws) => join(ws, "scripts", "skills", "setup-skills.mjs");

describe("setup-skills", () => {
  it("mirrors AGENTS.md to parent root", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    const dest = join(tmp.dir, "AGENTS.md");
    assert.ok(existsSync(dest));
    assert.ok(lstatSync(dest).isSymbolicLink(), "AGENTS.md should be a symlink");
    assert.equal(readFileSync(dest, "utf8"), "# Test AGENTS\n");
  });

  it("migrates existing AGENTS.md copy to symlink", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const dest = join(tmp.dir, "AGENTS.md");
    writeFileSync(dest, "# Test AGENTS\n");

    runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    assert.ok(lstatSync(dest).isSymbolicLink(), "AGENTS.md should be migrated to symlink");
    assert.equal(readFileSync(dest, "utf8"), "# Test AGENTS\n");
  });

  it("warns on divergent AGENTS.md copy but still migrates to symlink", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const dest = join(tmp.dir, "AGENTS.md");
    writeFileSync(dest, "# Locally edited AGENTS\n");

    const { stderr } = runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    assert.ok(stderr.includes("local edits"), "should warn about divergent content");
    assert.ok(lstatSync(dest).isSymbolicLink(), "AGENTS.md should still be migrated to symlink");
    assert.equal(readFileSync(dest, "utf8"), "# Test AGENTS\n");
  });

  it("migrates pre-existing real CLAUDE.md copy to symlink", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const claude = join(tmp.dir, "CLAUDE.md");
    writeFileSync(claude, "# Test AGENTS\n");

    runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    assert.ok(lstatSync(claude).isSymbolicLink(), "CLAUDE.md should be migrated to symlink");
    assert.equal(readlinkSync(claude), "AGENTS.md");
  });

  it("warns on divergent CLAUDE.md copy but still migrates to symlink", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const claude = join(tmp.dir, "CLAUDE.md");
    writeFileSync(claude, "# Custom CLAUDE content\n");

    const { stderr } = runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    assert.ok(stderr.includes("local edits"), "should warn about divergent CLAUDE.md content");
    assert.ok(lstatSync(claude).isSymbolicLink(), "CLAUDE.md should still be migrated to symlink");
    assert.equal(readlinkSync(claude), "AGENTS.md");
  });

  it("edits via parent-root AGENTS.md update canonical", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    const dest = join(tmp.dir, "AGENTS.md");
    const canonical = join(ws, "root-config", "AGENTS.md");
    writeFileSync(dest, "# Updated via symlink\n");

    assert.equal(readFileSync(canonical, "utf8"), "# Updated via symlink\n");
  });

  it("mirrors CLAUDE.md symlink to parent root", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    const claude = join(tmp.dir, "CLAUDE.md");
    const agents = join(tmp.dir, "AGENTS.md");
    assert.ok(existsSync(claude));
    assert.ok(lstatSync(claude).isSymbolicLink(), "CLAUDE.md should be a symlink");
    assert.equal(readlinkSync(claude), "AGENTS.md");
    assert.equal(readFileSync(claude, "utf8"), readFileSync(agents, "utf8"));
  });

  it("mirrors MCP configs to parent root", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const rc = join(ws, "root-config");
    const mcpContent = JSON.stringify({
      mcpServers: {
        context7: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
          env: {},
        },
      },
    }, null, 2) + "\n";
    writeFileSync(join(rc, ".agents", "mcp.json"), mcpContent);
    symlinkSync(".agents/mcp.json", join(rc, ".mcp.json"));
    mkdirSync(join(rc, ".cursor"), { recursive: true });
    symlinkSync("../.agents/mcp.json", join(rc, ".cursor", "mcp.json"));
    mkdirSync(join(rc, ".codex"), { recursive: true });
    writeFileSync(join(rc, ".codex", "config.toml"), "[mcp_servers.context7]\ncommand = \"npx\"\n");
    mkdirSync(join(rc, ".vscode"), { recursive: true });
    writeFileSync(join(rc, ".vscode", "mcp.json"), '{"servers":{"context7":{}}}\n');

    runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    const canonical = join(rc, ".agents", "mcp.json");
    const agentsMcp = join(tmp.dir, ".agents", "mcp.json");
    const rootMcp = join(tmp.dir, ".mcp.json");
    const cursorMcp = join(tmp.dir, ".cursor", "mcp.json");
    const codexToml = join(tmp.dir, ".codex", "config.toml");
    const vscodeMcp = join(tmp.dir, ".vscode", "mcp.json");

    assert.ok(lstatSync(agentsMcp).isSymbolicLink(), ".agents/mcp.json should be a symlink");
    assert.equal(readFileSync(agentsMcp, "utf8"), mcpContent);
    assert.ok(lstatSync(rootMcp).isSymbolicLink(), ".mcp.json should be a symlink");
    assert.equal(readlinkSync(rootMcp), ".agents/mcp.json");
    assert.ok(lstatSync(cursorMcp).isSymbolicLink(), ".cursor/mcp.json should be a symlink");
    assert.equal(readFileSync(cursorMcp, "utf8"), mcpContent);
    assert.ok(lstatSync(codexToml).isSymbolicLink(), ".codex/config.toml should be a symlink");
    assert.ok(lstatSync(vscodeMcp).isSymbolicLink(), ".vscode/mcp.json should be a symlink");
    assert.equal(readFileSync(rootMcp, "utf8"), readFileSync(canonical, "utf8"));
  });

  it("edits via parent-root .mcp.json update canonical", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const rc = join(ws, "root-config");
    writeFileSync(join(rc, ".agents", "mcp.json"), '{"mcpServers":{}}\n');
    symlinkSync(".agents/mcp.json", join(rc, ".mcp.json"));

    runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    const dest = join(tmp.dir, ".mcp.json");
    const canonical = join(rc, ".agents", "mcp.json");
    writeFileSync(dest, '{"mcpServers":{"context7":{}}}\n');

    assert.equal(readFileSync(canonical, "utf8"), '{"mcpServers":{"context7":{}}}\n');
  });

  it("does NOT mirror README.md or skills-lock.json", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    assert.ok(!existsSync(join(tmp.dir, "README.md")));
    assert.ok(!existsSync(join(tmp.dir, "skills-lock.json")));
  });

  it("mirrors .env.example to parent root", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    writeFileSync(join(ws, "root-config", ".env.example"), "# MY_API_KEY=\n");

    runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    assert.ok(lstatSync(join(tmp.dir, ".env.example")).isSymbolicLink());
    assert.equal(readFileSync(join(tmp.dir, ".env.example"), "utf8"), "# MY_API_KEY=\n");
  });

  it("creates .agents/ at parent root with symlinked L2 entries", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), ["--ensure"], { cwd: ws });

    const agentsDir = join(tmp.dir, ".agents");
    assert.ok(existsSync(agentsDir));
    const skillsLink = join(agentsDir, "skills");
    assert.ok(lstatSync(skillsLink).isSymbolicLink(), ".agents/skills should be a symlink");
    assert.ok(existsSync(join(skillsLink, "demo", "SKILL.md")), "skill content accessible through symlink");
  });

  it("creates skill symlinks for all tools", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), [], { cwd: ws });

    for (const sub of [".claude/skills/demo", "skills/demo"]) {
      const p = join(tmp.dir, sub);
      assert.ok(existsSync(p), `missing ${sub}`);
      assert.ok(lstatSync(p).isSymbolicLink(), `not symlink: ${sub}`);
    }
  });

  it("creates project skill symlinks", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, {
      withSkill: "ws-skill",
      withProject: { name: "my-app", skill: "app-skill" },
    });
    runScript(setupScript(ws), [], { cwd: ws });

    for (const sub of [".claude/skills/app-skill"]) {
      const p = join(tmp.dir, "my-app", sub);
      assert.ok(existsSync(p), `missing project ${sub}`);
      assert.ok(lstatSync(p).isSymbolicLink(), `not symlink: project ${sub}`);
    }
  });

  it("recreates workspace repo .claude/skills after cleanCliArtifacts", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir);
    const skillDir = join(ws, ".agents", "skills", "repo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: repo-skill\n---\n");

    runScript(setupScript(ws), [], { cwd: ws });

    const link = join(ws, ".claude", "skills", "repo-skill");
    assert.ok(existsSync(link), "missing workspace repo .claude/skills/repo-skill");
    assert.ok(lstatSync(link).isSymbolicLink(), "workspace repo skill link should be a symlink");
  });

  it("creates nested project skill symlinks at multiple levels", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "ws-skill" });
    for (const [projPath, skillName] of [
      ["website", "site-skill"],
      ["website/backend", "api-skill"],
      ["website/backend/service", "svc-skill"],
    ]) {
      const skillDir = join(tmp.dir, projPath, ".agents", "skills", skillName);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${skillName}\n---\n`);
    }

    runScript(setupScript(ws), [], { cwd: ws });

    for (const [projPath, skillName] of [
      ["website", "site-skill"],
      ["website/backend", "api-skill"],
      ["website/backend/service", "svc-skill"],
    ]) {
      const p = join(tmp.dir, projPath, ".claude", "skills", skillName);
      assert.ok(existsSync(p), `missing nested project .claude/skills for ${projPath}`);
      assert.ok(lstatSync(p).isSymbolicLink(), `not symlink: ${projPath}/.claude/skills/${skillName}`);
    }
  });

  it("is idempotent", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), ["--ensure"], { cwd: ws });
    const { exitCode } = runScript(setupScript(ws), ["--ensure"], { cwd: ws });
    assert.equal(exitCode, 0);
    assert.ok(existsSync(join(tmp.dir, ".claude", "skills", "demo")));
  });

  it("cleans stale symlinks after skill removal", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), ["--ensure"], { cwd: ws });
    assert.ok(existsSync(join(tmp.dir, ".claude", "skills", "demo")));

    rmSync(join(ws, "root-config", ".agents", "skills", "demo"), { recursive: true });
    runScript(setupScript(ws), ["--ensure"], { cwd: ws });
    assert.ok(!existsSync(join(tmp.dir, ".claude", "skills", "demo")));
  });

  it("--clean removes legacy AGENTS.md copy matching canonical", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const dest = join(tmp.dir, "AGENTS.md");
    writeFileSync(dest, "# Test AGENTS\n");

    runScript(setupScript(ws), ["--clean"], { cwd: ws });

    assert.ok(!existsSync(dest), "legacy AGENTS.md copy should be removed");
  });

  it("--clean warns on locally-edited legacy AGENTS.md copy", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const dest = join(tmp.dir, "AGENTS.md");
    writeFileSync(dest, "# Locally edited AGENTS\n");

    const { stdout, stderr } = runScript(setupScript(ws), ["--clean"], { cwd: ws });
    const output = stdout + stderr;

    assert.ok(existsSync(dest), "locally-edited AGENTS.md should not be removed");
    assert.ok(output.includes("local edits"), "should warn about local edits");
  });

  it("--clean removes legacy CLAUDE.md copy matching canonical", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const claude = join(tmp.dir, "CLAUDE.md");
    writeFileSync(claude, "# Test AGENTS\n");

    runScript(setupScript(ws), ["--clean"], { cwd: ws });

    assert.ok(!existsSync(claude), "legacy CLAUDE.md copy should be removed");
  });

  it("--clean warns on locally-edited legacy CLAUDE.md copy", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const claude = join(tmp.dir, "CLAUDE.md");
    writeFileSync(claude, "# Custom CLAUDE content\n");

    const { stdout, stderr } = runScript(setupScript(ws), ["--clean"], { cwd: ws });
    const output = stdout + stderr;

    assert.ok(existsSync(claude), "locally-edited CLAUDE.md should not be removed");
    assert.ok(output.includes("local edits"), "should warn about local edits");
  });

  it("--clean removes all mirrored files and symlinks", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    runScript(setupScript(ws), [], { cwd: ws });
    assert.ok(existsSync(join(tmp.dir, "AGENTS.md")));

    runScript(setupScript(ws), ["--clean"], { cwd: ws });
    assert.ok(!existsSync(join(tmp.dir, "AGENTS.md")));
    assert.ok(!existsSync(join(tmp.dir, "CLAUDE.md")));
    assert.ok(!existsSync(join(tmp.dir, ".claude", "skills", "demo")));
  });

  it("--clean removes stale project links even after .agents/skills was removed", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, {
      withProject: { name: "website/backend", skill: "api-skill" },
    });
    runScript(setupScript(ws), [], { cwd: ws });
    assert.ok(existsSync(join(tmp.dir, "website", "backend", ".claude", "skills", "api-skill")));

    rmSync(join(tmp.dir, "website", "backend", ".agents", "skills"), { recursive: true, force: true });
    runScript(setupScript(ws), ["--clean"], { cwd: ws });

    assert.ok(!existsSync(join(tmp.dir, "website", "backend", ".claude", "skills", "api-skill")));
  });

  it("cleans empty parent dirs when project skills are removed", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, {
      withProject: { name: "my-app", skill: "temp-skill" },
    });
    runScript(setupScript(ws), [], { cwd: ws });
    assert.ok(existsSync(join(tmp.dir, "my-app", ".claude", "skills", "temp-skill")));

    rmSync(join(tmp.dir, "my-app", ".agents", "skills", "temp-skill"), { recursive: true });
    runScript(setupScript(ws), [], { cwd: ws });

    assert.ok(!existsSync(join(tmp.dir, "my-app", ".claude", "skills")));
    assert.ok(!existsSync(join(tmp.dir, "my-app", ".claude")));
  });

  it("cleans pre-existing bare skills/ inside root-config on setup", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const rcSkills = join(ws, "root-config", "skills");
    mkdirSync(rcSkills, { recursive: true });
    symlinkSync(
      join("..", ".agents", "skills", "demo"),
      join(rcSkills, "demo"),
    );
    assert.ok(existsSync(join(rcSkills, "demo")));

    runScript(setupScript(ws), [], { cwd: ws });
    assert.ok(!existsSync(rcSkills), "root-config/skills/ should be removed by setup");
    assert.ok(existsSync(join(tmp.dir, "skills", "demo")), "workspace-root skills/ symlink should still exist");
  });

  it("warns when lock file has entries not matching disk", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "real-skill" });
    const lockPath = join(ws, "root-config", "skills-lock.json");
    writeFileSync(lockPath, JSON.stringify({
      version: 1,
      skills: {
        "real-skill": { source: "a/b" },
        "ghost-skill": { source: "c/d" },
      },
    }) + "\n");

    const { stderr } = runScript(setupScript(ws), [], { cwd: ws });
    assert.ok(stderr.includes("ghost-skill"), "should warn about ghost entry in lock");
  });
});

describe("lock file integrity (source repo)", () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

  it("workspace/skills-lock.json is not a symlink", () => {
    const result = validateLockFile(REPO);
    assert.equal(result.isSymlink, false, "workspace/skills-lock.json must be a regular file, not a symlink");
  });

  it("workspace/skills-lock.json entries all exist on disk", () => {
    const result = validateLockFile(REPO);
    assert.deepEqual(
      result.extra, [],
      `workspace/skills-lock.json has entries with no matching directory: ${result.extra.join(", ")}`,
    );
  });

  it("root-config/skills-lock.json entries all exist on disk", () => {
    const result = validateLockFile(join(REPO, "root-config"));
    assert.deepEqual(
      result.extra, [],
      `root-config/skills-lock.json has entries with no matching directory: ${result.extra.join(", ")}`,
    );
  });

  it("lock files are not identical (cross-contamination guard)", () => {
    const wsLock = readFileSync(join(REPO, "skills-lock.json"), "utf8");
    const rcLock = readFileSync(join(REPO, "root-config", "skills-lock.json"), "utf8");
    assert.notEqual(wsLock, rcLock, "workspace and root-config lock files should not be identical");
  });
});
