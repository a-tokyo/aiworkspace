import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectHttpBearerVars,
  buildMcpEnvMarkerBlock,
  upsertMcpEnvMarkerBlock,
  removeMcpEnvMarkerBlock,
  extractMcpEnvMarkerBlock,
  isCliAvailable,
  mcpEnvInstanceId,
  resolvePwshProfilePath,
  defaultWindowsPowerShell51Profile,
  MCP_ENV_MARKER_START,
  MCP_ENV_MARKER_END,
} from "../scripts/lib.mjs";
import { makeTmpDir } from "./helpers.mjs";

describe("collectHttpBearerVars", () => {
  it("collects Bearer header placeholders from HTTP servers", () => {
    const keys = collectHttpBearerVars({
      github: {
        type: "http",
        url: "https://example.com",
        headers: { Authorization: "Bearer ${env:GITHUB_PAT}" },
      },
      sonar: {
        type: "http",
        url: "https://example.com",
        headers: { Authorization: "Bearer ${env:SONAR_TOKEN}" },
      },
      oauth: { type: "http", url: "https://example.com/mcp" },
    });
    assert.deepEqual(keys, ["GITHUB_PAT", "SONAR_TOKEN"]);
  });
});

describe("isCliAvailable", () => {
  it("returns false when which/where fails", () => {
    assert.equal(isCliAvailable("pwsh", () => ({ status: 1, stdout: "" })), false);
  });

  it("returns true when which/where succeeds", () => {
    assert.equal(
      isCliAvailable("pwsh", () => ({ status: 0, stdout: "/usr/bin/pwsh\n" })),
      true,
    );
  });
});

describe("resolvePwshProfilePath", () => {
  it("uses Windows PowerShell 5.1 profile when pwsh is absent on Windows", () => {
    const home = "C:\\Users\\tester";
    const path = resolvePwshProfilePath(home, {
      platformName: "win32",
      userProfile: "C:\\Users\\tester",
      isCliAvailableFn: (cmd) => cmd === "powershell",
      existsSyncFn: () => false,
    });
    assert.equal(path, defaultWindowsPowerShell51Profile(home, "C:\\Users\\tester"));
  });

  it("prefers PowerShell 7 profile when pwsh is available on Windows", () => {
    const home = "C:\\Users\\tester";
    const path = resolvePwshProfilePath(home, {
      platformName: "win32",
      userProfile: "C:\\Users\\tester",
      isCliAvailableFn: (cmd) => cmd === "pwsh",
      existsSyncFn: () => false,
    });
    assert.match(path, /Documents[\\/]PowerShell[\\/]Microsoft\.PowerShell_profile\.ps1$/);
  });
});

describe("mcp env marker blocks", () => {
  const block = buildMcpEnvMarkerBlock({
    shell: "zsh",
    envScriptPath: "/tmp/ws/scripts/workspace-env.sh",
  });

  it("builds posix marker block with baked scripts dir", () => {
    assert.match(block, new RegExp(MCP_ENV_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(block, /__aiworkspace_mcp_env/);
    assert.match(block, /workspace-env\.sh.*\/tmp\/ws\/scripts/);
    assert.match(block, /unset -f __aiworkspace_mcp_env/);
  });

  it("uses $HOME-relative scripts dir when workspace is under home", () => {
    const homeBlock = buildMcpEnvMarkerBlock({
      shell: "zsh",
      envScriptPath: "/Users/alice/dev/acme/workspace/scripts/workspace-env.sh",
      home: "/Users/alice",
    });
    assert.match(homeBlock, /_d="\$HOME\/dev\/acme\/workspace\/scripts"/);
    assert.match(homeBlock, /\$_d\/workspace-env\.sh/);
    assert.doesNotMatch(homeBlock, /\/Users\/alice/);
  });

  it("uses USERPROFILE-relative path in pwsh when under home", () => {
    const pwshHome = buildMcpEnvMarkerBlock({
      shell: "pwsh",
      envScriptPath: "C:\\Users\\alice\\dev\\acme\\workspace\\scripts\\workspace-env.ps1",
      home: "C:\\Users\\alice",
    });
    assert.match(pwshHome, /\$d = "\$env:USERPROFILE\\dev\\acme\\workspace\\scripts"/);
    assert.match(pwshHome, /workspace-env\.ps1/);
    assert.doesNotMatch(pwshHome, /Users\\alice/);
  });

  it("escapes shell metacharacters in posix marker block", () => {
    const dangerous = buildMcpEnvMarkerBlock({
      shell: "bash",
      envScriptPath: "/tmp/$HOME/`whoami`/scripts/workspace-env.sh",
    });
    assert.match(dangerous, /\\\$HOME/);
    assert.match(dangerous, /\\`whoami\\`/);
    assert.match(dangerous, /__aiworkspace_mcp_env\(\)/);
  });

  it("posix marker block preserves positional parameters", { skip: !isCliAvailable("bash") }, () => {
    const marker = buildMcpEnvMarkerBlock({
      shell: "bash",
      envScriptPath: "/nonexistent/workspace-env.sh",
    });
    const body = marker
      .split("\n")
      .filter((line) => !line.includes("aiworkspace-mcp-env") && !line.startsWith("#"))
      .join("\n");
    const r = spawnSync("bash", ["-c", `set -- kept-pos; ${body}; printf '%s' "$1"`], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "kept-pos");
  });

  it("builds pwsh marker block with single-quoted paths when outside home", () => {
    const pwshBlock = buildMcpEnvMarkerBlock({
      shell: "pwsh",
      envScriptPath: "D:\\ws\\scripts\\workspace-env.ps1",
      home: "C:\\Users\\alice",
    });
    assert.match(pwshBlock, /'D:\\ws\\scripts\\workspace-env\.ps1'/);
    assert.doesNotMatch(pwshBlock, /USERPROFILE/);
  });

  it("replaces the same clone's own block when its content changes", () => {
    const id = "aaaa1111";
    const original = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/tmp/ws/scripts/workspace-env.sh", id });
    const first = upsertMcpEnvMarkerBlock("# custom\n", { id, block: original });
    const updated = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/new/path/workspace-env.sh", id });
    const second = upsertMcpEnvMarkerBlock(first, { id, block: updated });
    assert.match(second, /\/new\/path\/workspace-env\.sh/);
    assert.doesNotMatch(second, /\/tmp\/ws\/scripts/);
    assert.match(second, /# custom/);
    assert.equal(second.match(/aiworkspace-mcp-env:aaaa1111/g)?.length, 2);
  });

  it("appends a different clone's block instead of clobbering an existing one", () => {
    const idA = "aaaa1111";
    const idB = "bbbb2222";
    const blockA = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/tmp/ws/scripts/workspace-env.sh", id: idA });
    const first = upsertMcpEnvMarkerBlock("# custom\n", { id: idA, block: blockA });
    const blockB = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/new/path/workspace-env.sh", id: idB });
    const second = upsertMcpEnvMarkerBlock(first, { id: idB, block: blockB });
    assert.match(second, /\/tmp\/ws\/scripts/);
    assert.match(second, /\/new\/path\/workspace-env\.sh/);
    assert.match(second, /# custom/);
  });

  it("migrates a legacy (pre-fix) block in place when it's unmistakably this clone's own", () => {
    const legacy = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/tmp/ws/scripts/workspace-env.sh" });
    const withLegacy = upsertMcpEnvMarkerBlock("# custom\n", { block: legacy });
    assert.match(withLegacy, /# >>> aiworkspace-mcp-env >>>/);

    const migrated = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/tmp/ws/scripts/workspace-env.sh", id: "aaaa1111" });
    const after = upsertMcpEnvMarkerBlock(withLegacy, { id: "aaaa1111", block: migrated });
    assert.doesNotMatch(after, /# >>> aiworkspace-mcp-env >>>/);
    assert.match(after, /aiworkspace-mcp-env:aaaa1111/);
    assert.equal(after.match(/# >>> aiworkspace-mcp-env/g)?.length, 1);
  });

  it("leaves a foreign legacy block untouched when its body doesn't match", () => {
    const foreignLegacy = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/some/other/workspace-env.sh" });
    const withForeign = upsertMcpEnvMarkerBlock("# custom\n", { block: foreignLegacy });

    const mine = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/tmp/ws/scripts/workspace-env.sh", id: "aaaa1111" });
    const after = upsertMcpEnvMarkerBlock(withForeign, { id: "aaaa1111", block: mine });
    assert.match(after, /# >>> aiworkspace-mcp-env >>>/);
    assert.match(after, /\/some\/other\/workspace-env\.sh/);
    assert.match(after, /aiworkspace-mcp-env:aaaa1111/);
    assert.match(after, /\/tmp\/ws\/scripts\/workspace-env\.sh/);
  });

  it("re-adopts this clone's own block under a new id when the old id no longer matches (e.g. local/.mcp-env.id was lost)", () => {
    const oldId = "aaaa1111";
    const staleBlock = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/tmp/ws/scripts/workspace-env.sh", id: oldId });
    const withStale = upsertMcpEnvMarkerBlock("# custom\n", { id: oldId, block: staleBlock });

    const newId = "bbbb2222";
    const freshBlock = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/tmp/ws/scripts/workspace-env.sh", id: newId });
    const after = upsertMcpEnvMarkerBlock(withStale, { id: newId, block: freshBlock });

    assert.doesNotMatch(after, /aiworkspace-mcp-env:aaaa1111/);
    assert.equal(after.match(/# >>> aiworkspace-mcp-env/g)?.length, 1);
    assert.match(after, /aiworkspace-mcp-env:bbbb2222/);
  });

  it("removeMcpEnvMarkerBlock also re-adopts a stale-id block by body match", () => {
    const oldId = "aaaa1111";
    const staleBlock = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/tmp/ws/scripts/workspace-env.sh", id: oldId });
    const withStale = upsertMcpEnvMarkerBlock("# custom\n", { id: oldId, block: staleBlock });

    const newId = "bbbb2222";
    const freshBlock = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/tmp/ws/scripts/workspace-env.sh", id: newId });
    const after = removeMcpEnvMarkerBlock(withStale, { id: newId, block: freshBlock });
    assert.doesNotMatch(after, /aiworkspace-mcp-env/);
    assert.match(after, /# custom/);
  });

  it("removes only marked region", () => {
    const content = upsertMcpEnvMarkerBlock("before\n", { block });
    const stripped = removeMcpEnvMarkerBlock(content, { block });
    assert.match(stripped, /^before\n\n?$/);
    assert.doesNotMatch(stripped, /aiworkspace-mcp-env/);
  });

  it("removing one clone's block leaves another clone's block intact", () => {
    const idA = "aaaa1111";
    const idB = "bbbb2222";
    const blockA = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/tmp/ws/scripts/workspace-env.sh", id: idA });
    const blockB = buildMcpEnvMarkerBlock({ shell: "zsh", envScriptPath: "/new/path/workspace-env.sh", id: idB });
    const both = upsertMcpEnvMarkerBlock(upsertMcpEnvMarkerBlock("# custom\n", { id: idA, block: blockA }), { id: idB, block: blockB });
    const after = removeMcpEnvMarkerBlock(both, { id: idA, block: blockA });
    assert.doesNotMatch(after, /aiworkspace-mcp-env:aaaa1111/);
    assert.match(after, /aiworkspace-mcp-env:bbbb2222/);
    assert.match(after, /\/new\/path\/workspace-env\.sh/);
  });

  it("extracts only the managed marker region", () => {
    const content = upsertMcpEnvMarkerBlock("SECRET=do-not-leak\nbefore\n", { block });
    const extracted = extractMcpEnvMarkerBlock(content);
    assert.match(extracted, /aiworkspace-mcp-env/);
    assert.doesNotMatch(extracted, /SECRET=do-not-leak/);
    assert.equal(extractMcpEnvMarkerBlock("no block here"), "(no managed block)");
  });

  it("preserves blank lines outside the managed block", () => {
    const content = "line1\n\n\n\nline2\n";
    const inserted = upsertMcpEnvMarkerBlock(content, { block });
    assert.match(inserted, /\n\n\n\nline2/);
  });

  it("ignores an end marker that appears before the start marker", () => {
    const strayEnd = `${MCP_ENV_MARKER_END}\nnoise\n`;
    const content = upsertMcpEnvMarkerBlock(strayEnd, { block });
    assert.equal(content.match(new RegExp(MCP_ENV_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length, 1);
    const stripped = removeMcpEnvMarkerBlock(content, { block });
    assert.doesNotMatch(stripped, new RegExp(MCP_ENV_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(stripped, /noise/);
  });

  it("preserves CRLF line endings in profile content", () => {
    const crlfBlock = buildMcpEnvMarkerBlock({
      shell: "pwsh",
      envScriptPath: "D:\\ws\\scripts\\workspace-env.ps1",
      home: "C:\\Users\\alice",
    });
    const inserted = upsertMcpEnvMarkerBlock("before\r\n", { block: crlfBlock });
    assert.match(inserted, /\r\n/);
    assert.match(inserted, /aiworkspace-mcp-env/);
    const stripped = removeMcpEnvMarkerBlock(inserted, { block: crlfBlock });
    assert.doesNotMatch(stripped, /aiworkspace-mcp-env/);
    assert.match(stripped, /^before\r\n/);
  });
});

describe("mcpEnvInstanceId", () => {
  let tmp;
  afterEach(() => tmp?.cleanup());

  it("creates and persists an id under local/ on first call", () => {
    tmp = makeTmpDir();
    const id = mcpEnvInstanceId({ repoDir: tmp.dir });
    assert.match(id, /^[0-9a-f]{8}$/);
    assert.equal(readFileSync(join(tmp.dir, "local", ".mcp-env.id"), "utf8").trim(), id);
  });

  it("reuses the same id on subsequent calls (survives across calls, e.g. after moving the repo)", () => {
    tmp = makeTmpDir();
    const first = mcpEnvInstanceId({ repoDir: tmp.dir });
    const second = mcpEnvInstanceId({ repoDir: tmp.dir });
    assert.equal(first, second);
  });

  it("two separate repo dirs mint distinct ids", () => {
    const tmpA = makeTmpDir();
    const tmpB = makeTmpDir();
    try {
      const idA = mcpEnvInstanceId({ repoDir: tmpA.dir });
      const idB = mcpEnvInstanceId({ repoDir: tmpB.dir });
      assert.notEqual(idA, idB);
    } finally {
      tmpA.cleanup();
      tmpB.cleanup();
    }
  });

  it("with create:false, returns null instead of minting an id", () => {
    tmp = makeTmpDir();
    const id = mcpEnvInstanceId({ repoDir: tmp.dir, create: false });
    assert.equal(id, null);
  });

  it("with create:false, still reads an existing id without regenerating it", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, "local"), { recursive: true });
    writeFileSync(join(tmp.dir, "local", ".mcp-env.id"), "deadbeef\n");
    assert.equal(mcpEnvInstanceId({ repoDir: tmp.dir, create: false }), "deadbeef");
  });

  it("ignores a corrupted id file and mints a fresh valid one", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, "local"), { recursive: true });
    writeFileSync(join(tmp.dir, "local", ".mcp-env.id"), "not a valid id!!\n");
    const id = mcpEnvInstanceId({ repoDir: tmp.dir });
    assert.match(id, /^[0-9a-f]{8}$/);
    assert.equal(readFileSync(join(tmp.dir, "local", ".mcp-env.id"), "utf8").trim(), id);
  });

  it("with create:false, returns null for a corrupted id file rather than the raw value", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, "local"), { recursive: true });
    writeFileSync(join(tmp.dir, "local", ".mcp-env.id"), "not a valid id!!\n");
    assert.equal(mcpEnvInstanceId({ repoDir: tmp.dir, create: false }), null);
  });
});
