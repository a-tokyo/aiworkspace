import { mkdtempSync, mkdirSync, writeFileSync, cpSync, chmodSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REAL_WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REAL_SCRIPTS = join(REAL_WORKSPACE, "scripts");

export function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), "aiws-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Build a fake workspace tree in parentDir for integration tests.
 *
 *   parentDir/           ← WORKSPACE (parent root)
 *   ├── ws/              ← REPO_DIR
 *   │   ├── scripts/     ← copied from real workspace
 *   │   ├── root-config/ ← AGENTS.md, .agents/skills/
 *   │   ├── .agents/skills/
 *   │   └── package.json
 *   └── <project>/       ← optional sibling project
 */
export function buildFakeWorkspace(parentDir, opts = {}) {
  const { withMock = false, withSkill = null, withProject = null } = opts;
  const ws = join(parentDir, "ws");

  cpSync(REAL_SCRIPTS, join(ws, "scripts"), { recursive: true });

  mkdirSync(join(ws, "root-config", ".agents", "skills"), { recursive: true });
  writeFileSync(join(ws, "root-config", "AGENTS.md"), "# Test AGENTS\n");
  symlinkSync("AGENTS.md", join(ws, "root-config", "CLAUDE.md"));
  writeFileSync(join(ws, "root-config", "README.md"), "# Test README\n");
  writeFileSync(join(ws, "root-config", "skills-lock.json"), "{}\n");

  mkdirSync(join(ws, ".agents", "skills"), { recursive: true });
  writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "test-ws", private: true }, null, 2) + "\n");

  if (withSkill) {
    const skillDir = join(ws, "root-config", ".agents", "skills", withSkill);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${withSkill}\n---\n# ${withSkill}\n`);
  }

  if (withProject) {
    const projDir = join(parentDir, withProject.name);
    mkdirSync(join(projDir, ".agents", "skills"), { recursive: true });
    if (withProject.skill) {
      const sd = join(projDir, ".agents", "skills", withProject.skill);
      mkdirSync(sd, { recursive: true });
      writeFileSync(join(sd, "SKILL.md"), `---\nname: ${withProject.skill}\n---\n`);
    }
  }

  const mockLog = join(parentDir, "mock-skills.log");
  if (withMock) {
    const binDir = join(ws, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "skills"),
      `#!/bin/sh\nprintf '%s\\t%s\\n' "$(pwd)" "$*" >> "${mockLog}"\n`);
    chmodSync(join(binDir, "skills"), 0o755);
  }

  return { ws, mockLog };
}

export function runScript(scriptPath, args = [], opts = {}) {
  const result = spawnSync("node", [scriptPath, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}
