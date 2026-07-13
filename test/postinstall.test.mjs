import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";
import { nonInteractiveGitEnv } from "../scripts/lib.mjs";

const REAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Install a mock `skills` bin at ws/node_modules/.bin/skills that echoes to
 * stdout (to prove stdio is inherited) and logs "cwd \t args \t GIT_TERMINAL_PROMPT"
 * for each invocation.
 */
function installMockSkillsBin(ws, logPath) {
  const binDir = join(ws, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, "skills");
  writeFileSync(bin,
    `#!/bin/sh\n` +
    `echo "MOCK-SKILLS-RAN"\n` +
    `printf '%s\\t%s\\t%s\\n' "$(pwd)" "$*" "$GIT_TERMINAL_PROMPT" >> "${logPath}"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

function readCalls(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(line => {
    const [cwd, args, gitPrompt] = line.split("\t");
    return { cwd, args, gitPrompt };
  });
}

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

  it("restores skills via the local bin: visible, bounded, non-interactive", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir);
    const logPath = join(tmp.dir, "skills-calls.log");
    installMockSkillsBin(ws, logPath);

    // Populate both locks so the restore actually runs (empty locks are skipped).
    const lock = JSON.stringify({ version: 1, skills: { x: { source: "o/r", sourceType: "github" } } }) + "\n";
    writeFileSync(join(ws, "skills-lock.json"), lock);
    writeFileSync(join(ws, "root-config", "skills-lock.json"), lock);

    // Run WITHOUT GIT_TERMINAL_PROMPT set, so the assertion proves postinstall
    // injects it rather than merely forwarding an inherited value.
    const env = { ...process.env };
    delete env.GIT_TERMINAL_PROMPT;
    const r = runScript(join(ws, "scripts", "postinstall.mjs"), [], { cwd: ws, env });

    // Bounded: completes (runScript's own 30s timeout would surface a hang).
    assert.equal(r.exitCode, 0, r.stderr || r.stdout);

    // Visible: the heads-up line AND the child's own output reached stdout,
    // proving stdio is inherited (not "ignore" — the frozen-looking symptom).
    assert.ok(r.stdout.includes("Restoring skills"), `missing heads-up line:\n${r.stdout}`);
    assert.ok(r.stdout.includes("MOCK-SKILLS-RAN"), `child output not inherited:\n${r.stdout}`);

    const calls = readCalls(logPath);
    // Invoked for both REPO_DIR (ws) and ROOT_CONFIG (ws/root-config) via the local bin.
    assert.equal(calls.length, 2, JSON.stringify(calls));
    for (const call of calls) {
      assert.equal(call.args, "experimental_install");
      // Prompt suppression reached the child: git can't block on /dev/tty.
      assert.equal(call.gitPrompt, "0");
    }
    assert.ok(calls.some(c => c.cwd.endsWith(join("root-config"))), JSON.stringify(calls));
  });

  it("stays quiet when locks have no skills to restore", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir); // buildFakeWorkspace writes empty locks
    const logPath = join(tmp.dir, "skills-calls.log");
    installMockSkillsBin(ws, logPath);

    const r = runScript(join(ws, "scripts", "postinstall.mjs"), [], { cwd: ws });

    assert.equal(r.exitCode, 0, r.stderr || r.stdout);
    assert.ok(!r.stdout.includes("Restoring skills"), `should not announce a restore:\n${r.stdout}`);
    assert.equal(readCalls(logPath).length, 0, "skills bin should not be invoked for empty locks");
  });

  it("nonInteractiveGitEnv disables interactive git/ssh/credential prompts", () => {
    const env = nonInteractiveGitEnv({ PATH: "/usr/bin" });
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.GIT_SSH_COMMAND, "ssh -oBatchMode=yes");
    assert.equal(env.GCM_INTERACTIVE, "never");
    assert.equal(env.PATH, "/usr/bin");
  });

  it("nonInteractiveGitEnv preserves a caller-supplied GIT_SSH_COMMAND", () => {
    const env = nonInteractiveGitEnv({ GIT_SSH_COMMAND: "ssh -i /my/key" });
    assert.equal(env.GIT_SSH_COMMAND, "ssh -i /my/key");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  });
});
