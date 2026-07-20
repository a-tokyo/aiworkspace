import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";

const REAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let tmp;
afterEach(() => tmp?.cleanup());

function seedCheckScripts(ws) {
  cpSync(join(REAL, "scripts"), join(ws, "scripts"), { recursive: true });
}

describe("mcp-check-secrets", () => {
  it("warns when .env.local is missing but wrapped servers need secrets", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: {
            type: "stdio",
            command: "node",
            args: [
              "ws/scripts/mcp-load-env.mjs",
              "--only", "MY_API_KEY",
              "--exec", "--", "npx", "-y", "some-mcp",
            ],
          },
        },
      }, null, 2) + "\n",
    );

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
      env: { ...process.env, MY_API_KEY: "" },
    });
    assert.equal(r.status, 0);
    const out = `${r.stderr}${r.stdout}`;
    assert.match(out, /\.env\.local is missing/);
    assert.match(out, /MY_API_KEY/);
    assert.match(out, /\.env\.example/);
  });

  it("warns when wrapped server has missing --only vars in .env.local", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: {
            type: "stdio",
            command: "node",
            args: [
              "ws/scripts/mcp-load-env.mjs",
              "--only", "MY_API_KEY",
              "--exec", "--", "npx", "-y", "some-mcp",
            ],
          },
        },
      }, null, 2) + "\n",
    );
    writeFileSync(join(tmp.dir, ".env.local"), "# empty\n");

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
      env: { ...process.env, MY_API_KEY: "" },
    });
    assert.equal(r.status, 0);
    assert.match(`${r.stderr}${r.stdout}`, /MY_API_KEY/);
  });

  it("treats an empty placeholder in .env.local as missing", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: {
            type: "stdio",
            command: "node",
            args: [
              "ws/scripts/mcp-load-env.mjs",
              "--only", "MY_API_KEY",
              "--exec", "--", "npx", "-y", "some-mcp",
            ],
          },
        },
      }, null, 2) + "\n",
    );
    writeFileSync(join(tmp.dir, ".env.local"), "MY_API_KEY=\n");

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
      env: { ...process.env, MY_API_KEY: "" },
    });
    assert.equal(r.status, 0);
    assert.match(`${r.stderr}${r.stdout}`, /MY_API_KEY/);
  });

  it("warns about HTTP Bearer servers with Cursor shell setup hint", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: {
            type: "http",
            url: "https://api.githubcopilot.com/mcp/",
            headers: { Authorization: "Bearer ${env:GITHUB_PAT}" },
          },
        },
      }, null, 2) + "\n",
    );
    writeFileSync(join(tmp.dir, ".env.local"), "GITHUB_PAT=filled\n");

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
    });
    assert.equal(r.status, 0);
    const out = `${r.stderr}${r.stdout}`;
    assert.match(out, /Bearer token header/);
    assert.match(out, /github/);
    assert.match(out, /\$\{env:GITHUB_PAT\}/);
    assert.match(out, /mcp:install-shell/);
    assert.match(out, /setup\.md §4\.1/);
  });

  it("shell-quotes workspace repo path in install-shell hint", () => {
    tmp = makeTmpDir();
    const parent = join(tmp.dir, "parent$`root");
    const ws = join(parent, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer ${env:TOKEN}" },
          },
        },
      }, null, 2) + "\n",
    );
    writeFileSync(join(parent, ".env.local"), "TOKEN=x\n");

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
    });
    assert.equal(r.status, 0);
    const out = `${r.stderr}${r.stdout}`;
    assert.match(out, /mcp:install-shell/);
    assert.match(out, /parent\\\$/);
    assert.match(out, /\\`/);
  });

  it("formats multiple Bearer env vars as separate placeholders", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer ${env:TOKEN_A}${env:TOKEN_B}" },
          },
        },
      }, null, 2) + "\n",
    );

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
    });
    assert.equal(r.status, 0);
    const out = `${r.stderr}${r.stdout}`;
    assert.match(out, /\$\{env:TOKEN_A\}/);
    assert.match(out, /\$\{env:TOKEN_B\}/);
    assert.doesNotMatch(out, /\$\{env:TOKEN_A, TOKEN_B\}/);
  });

  it("echoes bare ${VAR} canonical headers verbatim without inventing ${env:} syntax", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          sonarqube: {
            type: "http",
            url: "https://sonar.example.com/mcp",
            headers: { Authorization: "Bearer ${SONAR_TOKEN}" },
          },
        },
      }, null, 2) + "\n",
    );

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
    });
    assert.equal(r.status, 0);
    const out = `${r.stderr}${r.stdout}`;
    assert.match(out, /Bearer \$\{SONAR_TOKEN\}/, "must echo the bare form actually on disk");
    assert.doesNotMatch(out, /\$\{env:SONAR_TOKEN\}/, "must not fabricate the Cursor twin's ${env:} syntax");
  });

  it("redacts a Bearer header that mixes a literal secret with a placeholder", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    // hasLiteralCredentials only rejects a header with zero ${ — a mixed literal+placeholder
    // header slips past that guard, so this simulates one already present in canonical
    // (hand-edited, or migrated from an older config) and checks the display never echoes
    // the literal secret text to the console.
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer sk-live-REALSECRET123 ${DECOY_VAR}" },
          },
        },
      }, null, 2) + "\n",
    );

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
    });
    assert.equal(r.status, 0);
    const out = `${r.stderr}${r.stdout}`;
    assert.doesNotMatch(out, /sk-live-REALSECRET123/, "literal secret text must never be echoed");
    assert.match(out, /\$\{DECOY_VAR\}/, "the placeholder name is still surfaced");
    assert.match(out, /redacted/i);
  });

  it("does not treat OAuth HTTP servers as secret-bearing", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
        },
      }, null, 2) + "\n",
    );
    writeFileSync(join(tmp.dir, ".env.local"), "# empty\n");

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
    });
    assert.equal(r.status, 0);
    assert.equal(`${r.stderr}${r.stdout}`.trim(), "");
  });

  it("stays silent when wrapped server vars are present", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    seedCheckScripts(ws);
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: {
            type: "stdio",
            command: "node",
            args: [
              "ws/scripts/mcp-load-env.mjs",
              "--only", "MY_API_KEY",
              "--exec", "--", "npx", "-y", "some-mcp",
            ],
          },
        },
      }, null, 2) + "\n",
    );
    writeFileSync(join(tmp.dir, ".env.local"), "MY_API_KEY=secret\n");

    const r = spawnSync(process.execPath, [join(ws, "scripts", "mcp-check-secrets.mjs")], {
      cwd: ws,
      encoding: "utf8",
      env: { ...process.env, MY_API_KEY: "" },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
  });
});
