import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

let tmp;
afterEach(() => tmp?.cleanup());

function seedWorkspace(ws, parent) {
  cpSync(join(TEST_DIR, "..", "scripts"), join(ws, "scripts"), { recursive: true });
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
  writeFileSync(join(parent, ".env.local"), "GITHUB_PAT=secret\n");
}

describe("install-shell-profile", () => {
  it("installs marked block with --yes", () => {
    tmp = makeTmpDir();
    const home = join(tmp.dir, "home");
    const ws = join(tmp.dir, "parent", "ws");
    mkdirSync(home, { recursive: true });
    seedWorkspace(ws, join(tmp.dir, "parent"));

    const zshrc = join(home, ".zshrc");
    writeFileSync(zshrc, "# existing\n");

    const r = spawnSync(
      process.execPath,
      [join(ws, "scripts", "install-shell-profile.mjs"), "--yes", "--shell", "zsh"],
      { cwd: ws, encoding: "utf8", env: { ...process.env, HOME: home } },
    );
    assert.equal(r.status, 0, r.stderr);

    const content = readFileSync(zshrc, "utf8");
    assert.match(content, /aiworkspace-mcp-env/);
    assert.match(content, /workspace-env\.sh/);
    assert.match(content, /# existing/);
    assert.match(content, /workspace-env\.sh.*scripts/);
    assert.ok(existsSync(join(ws, "scripts", ".mcp-env.paths")));
    const paths = readFileSync(join(ws, "scripts", ".mcp-env.paths"), "utf8");
    assert.match(paths, /AIWORKSPACE_NODE=/);
    assert.match(paths, /BEARER_KEYS=GITHUB_PAT/);
  });

  it("uninstall removes marked block only", () => {
    tmp = makeTmpDir();
    const home = join(tmp.dir, "home");
    const ws = join(tmp.dir, "parent", "ws");
    mkdirSync(home, { recursive: true });
    seedWorkspace(ws, join(tmp.dir, "parent"));
    const zshrc = join(home, ".zshrc");

    spawnSync(
      process.execPath,
      [join(ws, "scripts", "install-shell-profile.mjs"), "--yes", "--shell", "zsh"],
      { cwd: ws, env: { ...process.env, HOME: home } },
    );

    const r = spawnSync(
      process.execPath,
      [join(ws, "scripts", "install-shell-profile.mjs"), "--uninstall", "--yes", "--shell", "zsh"],
      { cwd: ws, encoding: "utf8", env: { ...process.env, HOME: home } },
    );
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(zshrc, "utf8");
    assert.doesNotMatch(content, /aiworkspace-mcp-env/);
  });

  it("exits cleanly when no Bearer servers configured", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    cpSync(join(TEST_DIR, "..", "scripts"), join(ws, "scripts"), { recursive: true });
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({ mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp" } } }, null, 2) + "\n",
    );

    const r = spawnSync(
      process.execPath,
      [join(ws, "scripts", "install-shell-profile.mjs"), "--yes"],
      { cwd: ws, encoding: "utf8" },
    );
    assert.equal(r.status, 0);
    assert.match(r.stdout, /nothing to install/i);
  });

  it("uninstall works when mcp.json has no Bearer servers", () => {
    tmp = makeTmpDir();
    const home = join(tmp.dir, "home");
    const ws = join(tmp.dir, "parent", "ws");
    mkdirSync(home, { recursive: true });
    seedWorkspace(ws, join(tmp.dir, "parent"));
    const zshrc = join(home, ".zshrc");

    spawnSync(
      process.execPath,
      [join(ws, "scripts", "install-shell-profile.mjs"), "--yes", "--shell", "zsh"],
      { cwd: ws, env: { ...process.env, HOME: home } },
    );

    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({ mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp" } } }, null, 2) + "\n",
    );

    const r = spawnSync(
      process.execPath,
      [join(ws, "scripts", "install-shell-profile.mjs"), "--uninstall", "--yes", "--shell", "zsh"],
      { cwd: ws, encoding: "utf8", env: { ...process.env, HOME: home } },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(readFileSync(zshrc, "utf8"), /aiworkspace-mcp-env/);
  });

  it("refreshes .mcp-env.paths when profiles are already up to date", () => {
    tmp = makeTmpDir();
    const home = join(tmp.dir, "home");
    const ws = join(tmp.dir, "parent", "ws");
    mkdirSync(home, { recursive: true });
    seedWorkspace(ws, join(tmp.dir, "parent"));
    const pathsFile = join(ws, "scripts", ".mcp-env.paths");

    spawnSync(
      process.execPath,
      [join(ws, "scripts", "install-shell-profile.mjs"), "--yes", "--shell", "zsh"],
      { cwd: ws, env: { ...process.env, HOME: home } },
    );
    writeFileSync(pathsFile, 'AIWORKSPACE_NODE="/stale/node"\n');

    const r = spawnSync(
      process.execPath,
      [join(ws, "scripts", "install-shell-profile.mjs"), "--yes", "--shell", "zsh"],
      { cwd: ws, encoding: "utf8", env: { ...process.env, HOME: home } },
    );
    assert.equal(r.status, 0, r.stderr);
    const paths = readFileSync(pathsFile, "utf8");
    assert.doesNotMatch(paths, /\/stale\/node/);
    assert.match(paths, new RegExp(JSON.stringify(process.execPath).slice(1, -1)));
  });

  it("rejects --shell when the next token is another flag", () => {
    tmp = makeTmpDir();
    const ws = join(tmp.dir, "ws");
    cpSync(join(TEST_DIR, "..", "scripts"), join(ws, "scripts"), { recursive: true });
    mkdirSync(join(ws, "root-config", ".agents"), { recursive: true });
    writeFileSync(
      join(ws, "root-config", ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: {
            type: "http",
            url: "https://example.com",
            headers: { Authorization: "Bearer ${env:GITHUB_PAT}" },
          },
        },
      }, null, 2) + "\n",
    );

    const r = spawnSync(
      process.execPath,
      [join(ws, "scripts", "install-shell-profile.mjs"), "--yes", "--shell", "--persist"],
      { cwd: ws, encoding: "utf8" },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--shell requires/);
  });
});
