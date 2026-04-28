import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";

let tmp;
afterEach(() => tmp?.cleanup());

const removeScript = (ws) => join(ws, "scripts", "skills", "remove-skill.mjs");

function readMockLog(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").map(line => {
    const [cwd, ...rest] = line.split("\t");
    return { cwd, args: rest.join("\t") };
  });
}

describe("remove-skill", () => {
  it("passes args through to skills CLI", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, { withMock: true });
    runScript(removeScript(ws), ["humanizer", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes("remove"));
    assert.ok(calls[0].args.includes("humanizer"));
  });

  it("routes --project to correct cwd", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, {
      withMock: true,
      withProject: { name: "my-app" },
    });
    runScript(removeScript(ws), ["some-skill", "--project", "my-app", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(calls[0].cwd.endsWith("my-app"));
  });

  it("defaults cwd to root-config without --project", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, { withMock: true });
    runScript(removeScript(ws), ["humanizer", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(calls[0].cwd.endsWith("root-config"));
  });

  it("routes --project with subdirectory to correct cwd", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, {
      withMock: true,
      withProject: { name: "website/backend" },
    });
    runScript(removeScript(ws), ["some-skill", "--project", "website/backend", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(calls[0].cwd.endsWith(join("website", "backend")));
  });

  it("auto-injects --yes when skill name is provided", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, { withMock: true });
    runScript(removeScript(ws), ["humanizer", "--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(calls[0].args.includes("--yes"));
  });

  it("does not inject --yes for interactive mode (no skill name)", () => {
    tmp = makeTmpDir();
    const { ws, mockLog } = buildFakeWorkspace(tmp.dir, { withMock: true });
    runScript(removeScript(ws), ["--no-setup"], { cwd: ws });

    const calls = readMockLog(mockLog);
    assert.ok(!calls[0].args.includes("--yes"));
  });
});
