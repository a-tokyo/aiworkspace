import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, lstatSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";
import { upgradeMcp } from "../scripts/upgrade-mcp.mjs";
import { readMcpJson, isImportableMcpFile } from "../scripts/lib.mjs";

const REAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_ROOT = join(REAL, "root-config");
const setupScript = (ws) => join(ws, "scripts", "skills", "setup-skills.mjs");

let tmp;
afterEach(() => tmp?.cleanup());

describe("readMcpJson", () => {
  it("reads mcpServers schema", () => {
    tmp = makeTmpDir();
    const p = join(tmp.dir, "mcp.json");
    writeFileSync(p, JSON.stringify({ mcpServers: { a: { type: "stdio" } } }) + "\n");
    const r = readMcpJson(p);
    assert.deepEqual(r.mcpServers, { a: { type: "stdio" } });
    assert.equal(r.schema, "mcpServers");
  });

  it("normalizes servers schema", () => {
    tmp = makeTmpDir();
    const p = join(tmp.dir, "mcp.json");
    writeFileSync(p, JSON.stringify({ servers: { b: { type: "http" } } }) + "\n");
    const r = readMcpJson(p);
    assert.deepEqual(r.mcpServers, { b: { type: "http" } });
    assert.equal(r.schema, "servers");
  });

  it("rejects array servers", () => {
    tmp = makeTmpDir();
    const p = join(tmp.dir, "mcp.json");
    writeFileSync(p, JSON.stringify({ servers: [] }) + "\n");
    assert.equal(readMcpJson(p), null);
  });

  it("falls back to servers when mcpServers is invalid", () => {
    tmp = makeTmpDir();
    const p = join(tmp.dir, "mcp.json");
    writeFileSync(p, JSON.stringify({ mcpServers: [], servers: { c: { type: "stdio" } } }) + "\n");
    const r = readMcpJson(p);
    assert.deepEqual(r.mcpServers, { c: { type: "stdio" } });
    assert.equal(r.schema, "servers");
  });
});

describe("upgradeMcp", () => {
  it("scaffolds MCP when none exist", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const { changedPaths } = upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });

    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    assert.ok(existsSync(canonical));
    assert.ok(readFileSync(canonical, "utf8").includes("context7"));
    assert.ok(changedPaths.length > 0);
    assert.ok(lstatSync(join(ws, "root-config", ".mcp.json")).isSymbolicLink());
  });

  it("keeps user github and adds context7 from template", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: {
          github: {
            type: "http",
            url: "https://api.githubcopilot.com/mcp/",
            headers: { Authorization: "Bearer ${GITHUB_PAT}" },
          },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(canonical, "utf8"));
    assert.ok(merged.mcpServers.github);
    assert.equal(
      merged.mcpServers.github.headers.Authorization,
      "Bearer ${GITHUB_PAT}",
    );
    assert.ok(merged.mcpServers.context7);
  });

  it("imports from parent .cursor/mcp.json when canonical missing", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    mkdirSync(join(tmp.dir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp.dir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          slack: { type: "stdio", command: "npx", args: ["-y", "slack-mcp"] },
        },
      }) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(join(ws, "root-config", ".agents", "mcp.json"), "utf8"));
    assert.ok(merged.mcpServers.slack);
    assert.ok(merged.mcpServers.context7);
  });

  it("skips parent-root servers with literal credentials", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    mkdirSync(join(tmp.dir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp.dir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          safe: { type: "stdio", command: "npx", args: ["-y", "safe-mcp"] },
          has_token: { type: "stdio", command: "npx", env: { API_KEY: "sk-abc123secret" } },
          has_placeholder: { type: "stdio", command: "npx", env: { API_KEY: "${MY_API_KEY}" } },
          has_header: { type: "http", url: "https://x.com", headers: { Authorization: "Bearer real-token" } },
          has_safe_header: { type: "http", url: "https://x.com", headers: { Accept: "application/json" } },
          has_path_env: { type: "stdio", command: "npx", env: { PATH: "/usr/local/bin" } },
        },
      }) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(join(ws, "root-config", ".agents", "mcp.json"), "utf8"));
    assert.ok(merged.mcpServers.safe, "safe server imported");
    assert.ok(merged.mcpServers.has_placeholder, "placeholder env imported");
    assert.ok(merged.mcpServers.has_safe_header, "non-secret header imported");
    assert.ok(merged.mcpServers.has_path_env, "PATH env not treated as credential");
    assert.equal(merged.mcpServers.has_token, undefined, "literal env token skipped");
    assert.equal(merged.mcpServers.has_header, undefined, "literal header token skipped");
  });

  it("user wins on server name conflict with template", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: {
          context7: { type: "stdio", command: "node", args: ["custom-context7.js"] },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(canonical, "utf8"));
    assert.equal(merged.mcpServers.context7.command, "node");
    assert.deepEqual(merged.mcpServers.context7.args, ["custom-context7.js"]);
  });

  it("does not import parent-root servers when canonical exists", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: { github: { type: "http", url: "https://example.com" } },
      }, null, 2) + "\n",
    );
    mkdirSync(join(tmp.dir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp.dir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: { secret_server: { type: "stdio", command: "secret", env: { TOKEN: "real-token" } } },
      }) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(canonical, "utf8"));
    assert.ok(merged.mcpServers.github, "canonical server preserved");
    assert.ok(merged.mcpServers.context7, "template server added");
    assert.equal(merged.mcpServers.secret_server, undefined, "parent-root server NOT imported when canonical exists");
  });

  it("does not import parent symlink into root-config", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(join(ws, "root-config", ".agents", "mcp.json"), '{"mcpServers":{}}\n');
    mkdirSync(join(tmp.dir, ".cursor"), { recursive: true });
    symlinkSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      join(tmp.dir, ".cursor", "mcp.json"),
    );
    assert.equal(isImportableMcpFile(join(tmp.dir, ".cursor", "mcp.json"), join(ws, "root-config")), false);

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(join(ws, "root-config", ".agents", "mcp.json"), "utf8"));
    assert.ok(merged.mcpServers.context7);
  });

  it("fails fast when canonical exists but is invalid", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(canonical, "not valid json {{{");

    assert.throws(
      () => upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws }),
      /could not be parsed/,
    );
    assert.equal(readFileSync(canonical, "utf8"), "not valid json {{{");
  });

  it("fails fast when vscode mcp.json exists but is invalid", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const vscodeMcp = join(ws, "root-config", ".vscode", "mcp.json");
    mkdirSync(dirname(vscodeMcp), { recursive: true });
    writeFileSync(vscodeMcp, "broken vscode json {{{");

    assert.throws(
      () => upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws }),
      /could not be parsed/,
    );
    assert.equal(readFileSync(vscodeMcp, "utf8"), "broken vscode json {{{");
  });

  it("is idempotent on second run", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const { changedPaths } = upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    assert.equal(changedPaths.length, 0);
  });

  it("folds vscode-only servers into canonical", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const vscodeMcp = join(ws, "root-config", ".vscode", "mcp.json");
    mkdirSync(dirname(vscodeMcp), { recursive: true });
    writeFileSync(
      vscodeMcp,
      JSON.stringify({
        servers: {
          linear: { type: "stdio", command: "npx", args: ["-y", "linear-mcp"] },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const canonical = JSON.parse(readFileSync(join(ws, "root-config", ".agents", "mcp.json"), "utf8"));
    assert.ok(canonical.mcpServers.linear, "vscode-only server should reach canonical");
    assert.ok(canonical.mcpServers.context7, "template server should be present");
  });

  it("skips vscode-only servers with literal credentials", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const vscodeMcp = join(ws, "root-config", ".vscode", "mcp.json");
    mkdirSync(dirname(vscodeMcp), { recursive: true });
    writeFileSync(
      vscodeMcp,
      JSON.stringify({
        servers: {
          safe: { type: "stdio", command: "npx", args: ["-y", "safe-mcp"] },
          has_token: { type: "stdio", command: "npx", env: { API_KEY: "sk-secret" } },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const canonical = JSON.parse(readFileSync(join(ws, "root-config", ".agents", "mcp.json"), "utf8"));
    assert.ok(canonical.mcpServers.safe);
    assert.equal(canonical.mcpServers.has_token, undefined);
  });

  it("creates codex toml with merged stdio servers", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    mkdirSync(join(tmp.dir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp.dir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          slack: { type: "stdio", command: "npx", args: ["-y", "slack-mcp"] },
        },
      }) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const codex = readFileSync(join(ws, "root-config", ".codex", "config.toml"), "utf8");
    assert.ok(codex.includes("[mcp_servers.context7]"), "template codex section present");
    assert.ok(codex.includes("[mcp_servers.slack]"), "imported stdio server in codex");
  });

  it("quotes special characters in generated codex sections", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    mkdirSync(join(tmp.dir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp.dir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "my.server": {
            type: "stdio",
            command: "C:\\tools\\mcp.exe",
            args: ['--msg', 'say "hi"'],
            env: { CUSTOM_MSG: "${MSG}" },
          },
        },
      }) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const codex = readFileSync(join(ws, "root-config", ".codex", "config.toml"), "utf8");
    assert.ok(codex.includes('[mcp_servers."my.server"]'));
    assert.ok(codex.includes('command = "C:\\\\tools\\\\mcp.exe"'));
    assert.ok(codex.includes('args = ["--msg","say \\"hi\\""]'));
    assert.ok(codex.includes('CUSTOM_MSG = "${MSG}"'));
  });

  it("mirrors to parent root after upgradeMcp + setup", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    runScript(setupScript(ws), ["--ensure"], { cwd: ws });
    assert.ok(lstatSync(join(tmp.dir, ".mcp.json")).isSymbolicLink());
    assert.ok(readFileSync(join(tmp.dir, ".mcp.json"), "utf8").includes("context7"));
  });
});
