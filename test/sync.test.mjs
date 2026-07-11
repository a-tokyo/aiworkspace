import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, readFileSync, writeFileSync, lstatSync, mkdirSync, cpSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";
import { runSync, resolveTemplateRoot } from "../scripts/sync.mjs";

const REAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_ROOT = join(REAL, "root-config");

let tmp;
afterEach(() => tmp?.cleanup());

describe("resolveTemplateRoot", () => {
  it("prefers node_modules/aiworkspace/root-config when installed", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const nmRoot = join(ws, "node_modules", "aiworkspace", "root-config");
    mkdirSync(join(nmRoot, ".agents"), { recursive: true });
    writeFileSync(join(nmRoot, ".agents", "mcp.json"), '{"mcpServers":{"from-pkg":{}}}\n');

    const resolved = resolveTemplateRoot(ws);
    assert.equal(resolved, nmRoot);
  });

  it("falls back to local root-config", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    assert.equal(resolveTemplateRoot(ws), join(ws, "root-config"));
  });
});

describe("runSync", () => {
  it("regenerates MCP twins and parent symlinks without modifying scripts/", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const marker = join(ws, "scripts", "sync-test-marker.mjs");
    writeFileSync(marker, "// unchanged-by-sync\n");

    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: {
          custom: { type: "http", url: "https://example.com/mcp" },
        },
      }, null, 2) + "\n",
    );

    const { changedPaths } = runSync({ templateRoot: TEMPLATE_ROOT, repoDir: ws });

    assert.ok(changedPaths.length > 0);
    assert.ok(existsSync(join(ws, "root-config", ".codex", "config.toml")));
    assert.ok(existsSync(join(ws, "root-config", ".vscode", "mcp.json")));
    const merged = JSON.parse(readFileSync(canonical, "utf8"));
    assert.ok(merged.mcpServers.custom);
    assert.ok(merged.mcpServers.context7, "bundled server merged from template");
    assert.equal(readFileSync(marker, "utf8"), "// unchanged-by-sync\n");
    assert.ok(lstatSync(join(tmp.dir, ".mcp.json")).isSymbolicLink());
  });
});

describe("sync CLI", () => {
  it("exits 0 and prints workspace synced", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const nmAiws = join(ws, "node_modules", "aiworkspace");
    mkdirSync(join(nmAiws, "root-config", ".agents"), { recursive: true });
    cpSync(TEMPLATE_ROOT, join(nmAiws, "root-config"), { recursive: true });

    const r = runScript(join(ws, "scripts", "sync.mjs"), [], { cwd: ws });
    assert.equal(r.exitCode, 0, r.stderr + r.stdout);
    assert.ok(
      (r.stdout + r.stderr).includes("Workspace synced"),
      `expected sync confirmation, got stdout=${r.stdout} stderr=${r.stderr}`,
    );
    assert.ok(existsSync(join(ws, "root-config", ".agents", "mcp.json")));
  });
});
