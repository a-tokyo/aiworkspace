import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectHttpBearerVars,
  buildMcpEnvMarkerBlock,
  upsertMcpEnvMarkerBlock,
  removeMcpEnvMarkerBlock,
  MCP_ENV_MARKER_START,
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

describe("mcp env marker blocks", () => {
  const block = buildMcpEnvMarkerBlock({
    shell: "zsh",
    envScriptPath: "/tmp/ws/scripts/workspace-env.sh",
  });

  it("builds posix marker block", () => {
    assert.match(block, new RegExp(MCP_ENV_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(block, /workspace-env\.sh/);
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
});
