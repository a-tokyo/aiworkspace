import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, lstatSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";
import { upgradeMcp, upgradeEnvScaffold, toVscodeServers, applySecretTransforms, wrapStdioWithEnvLoader, mcpLoadEnvRel } from "../scripts/upgrade-mcp.mjs";
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

  it("keeps user http server and adds context7 from template", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: {
          api: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer ${API_TOKEN}" },
          },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(canonical, "utf8"));
    assert.equal(merged.mcpServers.api.type, "http");
    assert.equal(merged.mcpServers.api.url, "https://example.com/mcp");
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

  it("skips null or non-object server configs without aborting", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    mkdirSync(join(tmp.dir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp.dir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          valid: { type: "stdio", command: "npx", args: ["-y", "ok-mcp"] },
          broken: null,
          also_broken: "stdio",
        },
      }) + "\n",
    );

    assert.doesNotThrow(() => upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws }));
    const merged = JSON.parse(readFileSync(join(ws, "root-config", ".agents", "mcp.json"), "utf8"));
    assert.ok(merged.mcpServers.valid);
    assert.ok(merged.mcpServers.context7);
    assert.equal(merged.mcpServers.broken, undefined);
    assert.equal(merged.mcpServers.also_broken, undefined);
  });

  it("refreshes bundled template servers and keeps user-only servers", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: {
          context7: { type: "stdio", command: "node", args: ["stale-context7.js"] },
          personal: { type: "stdio", command: "npx", args: ["-y", "personal-mcp"] },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(canonical, "utf8"));
    assert.equal(merged.mcpServers.context7.command, "npx");
    assert.deepEqual(merged.mcpServers.context7.args, ["-y", "@upstash/context7-mcp"]);
    assert.ok(merged.mcpServers.personal);
  });

  it("skips canonical servers with literal credentials", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: {
          safe: { type: "stdio", command: "npx", args: ["-y", "safe-mcp"] },
          has_token: { type: "stdio", command: "npx", env: { API_KEY: "sk-secret" } },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(canonical, "utf8"));
    assert.ok(merged.mcpServers.safe);
    assert.ok(merged.mcpServers.context7);
    assert.equal(merged.mcpServers.has_token, undefined);
  });

  it("migrates missing parent-root servers when canonical exists", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: { context7: { type: "stdio", command: "npx", args: ["-y", "@upstash/context7-mcp"] } },
      }, null, 2) + "\n",
    );
    mkdirSync(join(tmp.dir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp.dir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          personal: { type: "stdio", command: "npx", args: ["-y", "personal-mcp"] },
          secret_server: { type: "stdio", command: "secret", env: { TOKEN: "real-token" } },
        },
      }) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(canonical, "utf8"));
    assert.ok(merged.mcpServers.context7, "bundled server preserved");
    assert.ok(merged.mcpServers.personal, "parent-only server migrated into canonical");
    assert.equal(merged.mcpServers.secret_server, undefined, "parent server with literal credentials not imported");
  });

  it("does not overwrite canonical servers from parent-root", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: { custom: { type: "http", url: "https://example.com" } },
      }, null, 2) + "\n",
    );
    mkdirSync(join(tmp.dir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp.dir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: { custom: { type: "stdio", command: "npx", args: ["-y", "other-mcp"] } },
      }) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(canonical, "utf8"));
    assert.equal(merged.mcpServers.custom.type, "http");
    assert.equal(merged.mcpServers.custom.url, "https://example.com");
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

  it("skips mcp upgrade when template mcp.json exists but is invalid", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const badTemplate = join(tmp.dir, "bad-template");
    const templateMcp = join(badTemplate, ".agents", "mcp.json");
    mkdirSync(dirname(templateMcp), { recursive: true });
    writeFileSync(templateMcp, "{ invalid template json");

    const { changedPaths } = upgradeMcp({ templateRoot: badTemplate, repoDir: ws });
    assert.equal(changedPaths.length, 0);
    assert.ok(!existsSync(join(ws, "root-config", ".agents", "mcp.json")));
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

  it("skips mcp upgrade when template directory exists but mcp.json is missing", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const emptyTemplate = join(tmp.dir, "empty-template");
    mkdirSync(emptyTemplate, { recursive: true });

    const { changedPaths } = upgradeMcp({ templateRoot: emptyTemplate, repoDir: ws });
    assert.equal(changedPaths.length, 0);
    assert.ok(!existsSync(join(ws, "root-config", ".agents", "mcp.json")));
  });

  it("ignores invalid vscode mcp.json when canonical missing (migration skip)", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const vscodeMcp = join(ws, "root-config", ".vscode", "mcp.json");
    mkdirSync(dirname(vscodeMcp), { recursive: true });
    writeFileSync(vscodeMcp, "broken vscode json {{{");

    assert.doesNotThrow(() => upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws }));
    const canonical = JSON.parse(readFileSync(join(ws, "root-config", ".agents", "mcp.json"), "utf8"));
    assert.ok(canonical.mcpServers.context7);
    assert.equal(canonical.mcpServers.linear, undefined);
  });

  it("does not import vscode servers when canonical already exists", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({ mcpServers: { context7: { type: "stdio", command: "npx" } } }, null, 2) + "\n",
    );
    const vscodeMcp = join(ws, "root-config", ".vscode", "mcp.json");
    mkdirSync(dirname(vscodeMcp), { recursive: true });
    writeFileSync(
      vscodeMcp,
      JSON.stringify({ servers: { linear: { type: "stdio", command: "npx", args: ["-y", "linear-mcp"] } } }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(canonical, "utf8"));
    assert.equal(merged.mcpServers.linear, undefined, "vscode not read when canonical exists");
    const vscodeOut = JSON.parse(readFileSync(vscodeMcp, "utf8"));
    assert.ok(vscodeOut.servers.context7, "vscode twin emitted from canonical");
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

  it("preserves codex preamble when no mcp_servers section exists", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const codexToml = join(ws, "root-config", ".codex", "config.toml");
    mkdirSync(dirname(codexToml), { recursive: true });
    writeFileSync(codexToml, "# team settings\n\n[tool.codex]\nmodel = \"gpt-4\"\n");

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const codex = readFileSync(codexToml, "utf8");
    assert.ok(codex.includes("[tool.codex]"), "non-MCP preamble preserved");
    assert.ok(codex.includes("[mcp_servers.context7]"), "MCP sections emitted");
  });

  it("vscode twin adds envFile for wrapped stdio servers", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: {
          api: {
            type: "stdio",
            command: "npx",
            args: ["-y", "some-mcp"],
            env: { API_KEY: "${MY_API_KEY}" },
          },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const vscode = JSON.parse(readFileSync(join(ws, "root-config", ".vscode", "mcp.json"), "utf8"));
    assert.equal(vscode.servers.api.envFile, "${workspaceFolder}/.env.local");
    assert.equal(vscode.servers.api.command, "node");
  });

  it("toVscodeServers leaves ${env:VAR} unchanged", () => {
    const out = toVscodeServers({
      s: { env: { KEY: "${env:ALREADY}" }, headers: { Authorization: "Bearer ${TOKEN}" } },
    });
    assert.equal(out.s.env.KEY, "${env:ALREADY}");
    assert.equal(out.s.headers.Authorization, "Bearer ${env:TOKEN}");
  });

  it("wraps stdio servers with env placeholders on upgrade", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: {
          api: {
            type: "stdio",
            command: "npx",
            args: ["-y", "some-mcp"],
            env: { API_KEY: "${MY_API_KEY}" },
          },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const merged = JSON.parse(readFileSync(canonical, "utf8")).mcpServers.api;
    assert.equal(merged.type, "stdio");
    assert.equal(merged.command, "node");
    assert.ok(merged.args.some((a) => String(a).includes("mcp-load-env.mjs")));
    assert.ok(merged.args.includes("--only"));

    const codex = readFileSync(join(ws, "root-config", ".codex", "config.toml"), "utf8");
    assert.ok(codex.includes("[mcp_servers.api]"));
    assert.ok(codex.includes('command = "node"'));
    assert.ok(codex.includes("mcp-load-env.mjs"));
    assert.ok(codex.includes("[mcp_servers.context7]"), "stdio template server still emitted");

    const vscode = JSON.parse(readFileSync(join(ws, "root-config", ".vscode", "mcp.json"), "utf8"));
    assert.equal(vscode.servers.api.envFile, "${workspaceFolder}/.env.local");
  });

  it("context7 stays unwrapped when no secrets", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const ctx = JSON.parse(readFileSync(join(ws, "root-config", ".agents", "mcp.json"), "utf8"))
      .mcpServers.context7;
    assert.equal(ctx.command, "npx");
    assert.ok(!ctx.args?.some((a) => String(a).includes("mcp-load-env")));
  });

  it("wrapStdioWithEnvLoader strips all placeholder env vars", () => {
    const out = wrapStdioWithEnvLoader({
      type: "stdio",
      command: "npx",
      args: ["-y", "some-mcp"],
      env: {
        A: "aaaaaaaaaa${X}",
        B: "${Y}",
        PLAIN: "literal",
      },
    });
    assert.equal(out.command, "node");
    assert.deepEqual(out.env, { PLAIN: "literal" });
  });

  it("applySecretTransforms wraps stdio servers with env placeholders", () => {
    const out = applySecretTransforms({
      api: {
        type: "stdio",
        command: "npx",
        args: ["-y", "some-mcp"],
        env: { API_KEY: "${MY_API_KEY}" },
      },
    });
    assert.equal(out.api.command, "node");
    assert.ok(out.api.args.some((a) => String(a).includes("mcp-load-env.mjs")));
    assert.ok(out.api.args.includes("--only"));
    assert.ok(out.api.args.includes("--map"));
    assert.ok(out.api.args.includes("API_KEY:MY_API_KEY"));
  });

  it("toVscodeServers adds envFile for HTTP servers with secret placeholders", () => {
    const out = toVscodeServers({
      api: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${API_TOKEN}" },
      },
    });
    assert.equal(out.api.envFile, "${workspaceFolder}/.env.local");
  });

  it("codex http projection accepts ${env:VAR} bearer syntax", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: {
          custom: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer ${env:MY_TOKEN}" },
          },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const codex = readFileSync(join(ws, "root-config", ".codex", "config.toml"), "utf8");
    assert.ok(codex.includes("bearer_token_env_var = \"MY_TOKEN\""));
  });

  it("codex projects OAuth-only HTTP servers with rmcp flag and no bearer token", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: {
          slack: { type: "http", url: "https://mcp.slack.com/mcp" },
        },
      }, null, 2) + "\n",
    );

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const codex = readFileSync(join(ws, "root-config", ".codex", "config.toml"), "utf8");
    assert.ok(codex.includes("experimental_use_rmcp_client = true"), "rmcp flag injected for HTTP");
    assert.ok(codex.includes("[mcp_servers.slack]"), "oauth http server projected");
    assert.ok(codex.includes('url = "https://mcp.slack.com/mcp"'), "url emitted");
    assert.ok(!codex.includes("bearer_token_env_var"), "no bearer token for oauth-only server");

    const flagIdx = codex.indexOf("experimental_use_rmcp_client");
    const firstTableIdx = codex.search(/^\[/m);
    assert.ok(flagIdx !== -1 && flagIdx < firstTableIdx, "flag must precede the first table");
  });

  it("codex inserts rmcp flag before existing preamble tables", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".agents", "mcp.json");
    mkdirSync(dirname(canonical), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({
        mcpServers: { slack: { type: "http", url: "https://mcp.slack.com/mcp" } },
      }, null, 2) + "\n",
    );
    const codexToml = join(ws, "root-config", ".codex", "config.toml");
    mkdirSync(dirname(codexToml), { recursive: true });
    writeFileSync(codexToml, "# team settings\n\n[tool.codex]\nmodel = \"gpt-4\"\n");

    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const codex = readFileSync(codexToml, "utf8");
    assert.ok(codex.includes("[tool.codex]"), "preamble table preserved");
    const flagIdx = codex.indexOf("experimental_use_rmcp_client");
    const tableIdx = codex.indexOf("[tool.codex]");
    assert.ok(flagIdx !== -1 && flagIdx < tableIdx, "flag must precede the first preamble table");
  });

  it("codex does not add rmcp flag when there are no HTTP servers", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    upgradeMcp({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    const codex = readFileSync(join(ws, "root-config", ".codex", "config.toml"), "utf8");
    assert.ok(!codex.includes("experimental_use_rmcp_client"), "no rmcp flag without HTTP servers");
  });

  it("mcpLoadEnvRel derives path from repo directory name", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    assert.equal(mcpLoadEnvRel(ws), "ws/scripts/mcp-load-env.mjs");
  });

  it("upgradeEnvScaffold adds .env.example when missing", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    assert.ok(!existsSync(join(ws, "root-config", ".env.example")));

    const { changedPaths } = upgradeEnvScaffold({ templateRoot: TEMPLATE_ROOT, repoDir: ws });
    assert.ok(existsSync(join(ws, "root-config", ".env.example")));
    assert.ok(changedPaths.includes("root-config/.env.example"));
    assert.ok(!existsSync(join(ws, "root-config", ".envrc")));
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
    assert.ok(codex.includes('command = "node"'));
    assert.ok(codex.includes("mcp-load-env.mjs"));
    assert.ok(codex.includes('C:\\\\tools\\\\mcp.exe"'));
    assert.ok(codex.includes('say \\"hi\\""]'));
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
