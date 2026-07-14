import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  collectHttpBearerVars,
  buildMcpEnvMarkerBlock,
  upsertMcpEnvMarkerBlock,
  removeMcpEnvMarkerBlock,
  extractMcpEnvMarkerBlock,
  isCliAvailable,
  resolvePwshProfilePath,
  defaultWindowsPowerShell51Profile,
  MCP_ENV_MARKER_START,
  MCP_ENV_MARKER_END,
} from "../scripts/lib.mjs";

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

  it("appends then replaces marker region", () => {
    const first = upsertMcpEnvMarkerBlock("# custom\n", block);
    const next = buildMcpEnvMarkerBlock({
      shell: "zsh",
      envScriptPath: "/new/path/workspace-env.sh",
    });
    const second = upsertMcpEnvMarkerBlock(first, next);
    assert.match(second, /\/new\/path\/workspace-env\.sh/);
    assert.doesNotMatch(second, /\/tmp\/ws\/scripts/);
    assert.match(second, /# custom/);
  });

  it("removes only marked region", () => {
    const content = upsertMcpEnvMarkerBlock("before\n", block);
    const stripped = removeMcpEnvMarkerBlock(content);
    assert.match(stripped, /^before\n\n?$/);
    assert.doesNotMatch(stripped, /aiworkspace-mcp-env/);
  });

  it("extracts only the managed marker region", () => {
    const content = upsertMcpEnvMarkerBlock("SECRET=do-not-leak\nbefore\n", block);
    const extracted = extractMcpEnvMarkerBlock(content);
    assert.match(extracted, /aiworkspace-mcp-env/);
    assert.doesNotMatch(extracted, /SECRET=do-not-leak/);
    assert.equal(extractMcpEnvMarkerBlock("no block here"), "(no managed block)");
  });

  it("preserves blank lines outside the managed block", () => {
    const content = "line1\n\n\n\nline2\n";
    const inserted = upsertMcpEnvMarkerBlock(content, block);
    assert.match(inserted, /\n\n\n\nline2/);
  });

  it("ignores an end marker that appears before the start marker", () => {
    const strayEnd = `${MCP_ENV_MARKER_END}\nnoise\n`;
    const content = upsertMcpEnvMarkerBlock(strayEnd, block);
    assert.equal(content.match(new RegExp(MCP_ENV_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length, 1);
    const stripped = removeMcpEnvMarkerBlock(content);
    assert.doesNotMatch(stripped, new RegExp(MCP_ENV_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(stripped, /noise/);
  });

  it("preserves CRLF line endings in profile content", () => {
    const crlfBlock = buildMcpEnvMarkerBlock({
      shell: "pwsh",
      envScriptPath: "D:\\ws\\scripts\\workspace-env.ps1",
      home: "C:\\Users\\alice",
    });
    const inserted = upsertMcpEnvMarkerBlock("before\r\n", crlfBlock);
    assert.match(inserted, /\r\n/);
    assert.match(inserted, /aiworkspace-mcp-env/);
    const stripped = removeMcpEnvMarkerBlock(inserted);
    assert.doesNotMatch(stripped, /aiworkspace-mcp-env/);
    assert.match(stripped, /^before\r\n/);
  });
});
