import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";

let tmp;
afterEach(() => tmp?.cleanup());

const addScript = (ws) => join(ws, "scripts", "skills", "add-skill.mjs");

function readMockLog(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").map(line => {
    const [cwd, ...rest] = line.split("\t");
    return { cwd, args: rest.join("\t") };
  });
}

describe("add-skill", () => {
  it("passes args through to skills CLI", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, { withMock: true });
    runScript(addScript(ws), ["owner/repo", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes("add"));
    assert.ok(calls[0].args.includes("owner/repo"));
  });

  it("auto-injects --yes", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, { withMock: true });
    runScript(addScript(ws), ["owner/repo", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(calls[0].args.includes("--yes"));
  });

  it("does not inject --yes when already present", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, { withMock: true });
    runScript(addScript(ws), ["owner/repo", "--yes", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    const yesCount = calls[0].args.split("--yes").length - 1;
    assert.equal(yesCount, 1);
  });

  it("does not inject --yes for --help", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, { withMock: true });
    runScript(addScript(ws), ["--help"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].args.includes("--yes"));
  });

  it("routes --project to correct cwd", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, {
      withMock: true,
      withProject: { name: "my-app" },
    });
    runScript(addScript(ws), ["owner/repo", "--project", "my-app", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(calls[0].cwd.endsWith("my-app"));
  });

  it("defaults cwd to root-config without --project", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, { withMock: true });
    runScript(addScript(ws), ["owner/repo", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(calls[0].cwd.endsWith("root-config"));
  });

  it("routes --project with subdirectory to correct cwd", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, {
      withMock: true,
      withProject: { name: "website/backend" },
    });
    runScript(addScript(ws), ["owner/repo", "--project", "website/backend", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(calls[0].cwd.endsWith(join("website", "backend")));
  });

  it("rejects empty normalized --project path", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withMock: true });
    const { exitCode, stderr } = runScript(addScript(ws), ["owner/repo", "--project", "////", "--no-setup"], { cwd: ws });
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.includes("Error: --project must not be empty."));
  });

  it("rejects --project containing '.' or '..' path segments", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withMock: true });
    const { exitCode, stderr } = runScript(addScript(ws), ["owner/repo", "--project", "website/../backend", "--no-setup"], { cwd: ws });
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.includes("must not contain '.' or '..' path segments"));
  });

  it("rejects symlinked --project that resolves outside workspace", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withMock: true });
    const linkName = "external-project";
    symlinkSync("/tmp", join(tmp.dir, linkName));

    const { exitCode, stderr } = runScript(addScript(ws), ["owner/repo", "--project", linkName, "--no-setup"], { cwd: ws });
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.includes("must refer to a directory within the workspace"));
  });

  it("allows in-workspace project names starting with '..'", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, {
      withMock: true,
      withProject: { name: "..foo" },
    });
    runScript(addScript(ws), ["owner/repo", "--project", "..foo", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(calls[0].cwd.endsWith("..foo"));
  });

  it("normalizes blob URL to owner/repo", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, { withMock: true });
    runScript(addScript(ws), [
      "https://github.com/acme/cool-skill/blob/main/SKILL.md",
      "--no-setup",
    ], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(calls[0].args.includes("acme/cool-skill"));
  });

  it("shows usage error without source arg", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withMock: true });
    const { exitCode, stderr } = runScript(addScript(ws), [], { cwd: ws });
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.includes("Usage"));
  });
});
