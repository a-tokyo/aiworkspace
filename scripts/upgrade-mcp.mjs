#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * upgrade-mcp.mjs — Scaffold and merge MCP configs during npm run upgrade.
 */

import {
  existsSync, readFileSync, writeFileSync,
  mkdtempSync,
} from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  REPO_DIR, readMcpJson, isImportableMcpFile, ensureDir, safeSymlink,
  MCP_TEMPLATE_REL_PATHS,
} from "./lib.mjs";

/** Materialize root-config MCP template files from git upstream into a temp dir. */
export function materializeGitTemplateRoot(repoDir = REPO_DIR) {
  const tmp = mkdtempSync(join(tmpdir(), "aiws-mcp-template-"));
  for (const rel of MCP_TEMPLATE_REL_PATHS) {
    const dest = join(tmp, rel);
    ensureDir(dirname(dest));
    try {
      const gitPath = rel.replaceAll("\\", "/");
      const content = execFileSync(
        "git", ["show", `upstream/main:root-config/${gitPath}`],
        { cwd: repoDir, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
      );
      writeFileSync(dest, content);
    } catch { /* file may not exist in older upstream */ }
  }
  return tmp;
}

function loadTemplateServers(templateRoot) {
  const path = join(templateRoot, ".agents", "mcp.json");
  if (!existsSync(path)) {
    if (existsSync(templateRoot)) return { missing: path };
    return { servers: {} };
  }
  const parsed = readMcpJson(path);
  if (!parsed) return { invalid: path };
  return { servers: parsed.mcpServers };
}

const SECRET_KEY_PATTERN = /password|credential|secret|token|authorization|api[_-]?key|personal_access_token|(^|_)pat$|(^|_)token$/i;

function isServerConfig(config) {
  return config !== null && typeof config === "object" && !Array.isArray(config);
}

function hasLiteralCredentials(serverConfig) {
  if (!isServerConfig(serverConfig)) return false;
  const hasSuspiciousEnv = (obj) => {
    if (!obj || typeof obj !== "object") return false;
    return Object.entries(obj).some(
      ([k, v]) => SECRET_KEY_PATTERN.test(k) && typeof v === "string" && v.length > 0 && !v.includes("${"),
    );
  };
  const auth = serverConfig.headers?.Authorization;
  if (typeof auth === "string" && /^Bearer\s+\S+$/i.test(auth) && !auth.includes("${")) {
    return true;
  }
  return hasSuspiciousEnv(serverConfig.env) || hasSuspiciousEnv(serverConfig.headers);
}

function importServersFromFile(path, rootConfig, servers, { onlyMissing = false } = {}) {
  if (!isImportableMcpFile(path, rootConfig)) return;
  const parsed = readMcpJson(path);
  if (!parsed) return;
  for (const [name, config] of Object.entries(parsed.mcpServers)) {
    if (onlyMissing && name in servers) continue;
    if (!isServerConfig(config)) {
      console.warn(`  ⚠ Skipping "${name}" from ${path} — server config must be an object`);
      continue;
    }
    if (hasLiteralCredentials(config)) {
      console.warn(`  ⚠ Skipping "${name}" from ${path} — contains literal credentials (use \${VAR} placeholders)`);
      continue;
    }
    servers[name] = config;
  }
}

function collectUserServers(workspace, rootConfig) {
  const servers = {};
  const canonical = join(rootConfig, ".agents", "mcp.json");

  if (existsSync(canonical)) {
    const parsed = readMcpJson(canonical);
    if (parsed) {
      for (const [name, config] of Object.entries(parsed.mcpServers)) {
        if (!isServerConfig(config)) {
          console.warn(`  ⚠ Skipping "${name}" in ${canonical} — server config must be an object`);
          continue;
        }
        if (hasLiteralCredentials(config)) {
          console.warn(`  ⚠ Skipping "${name}" in ${canonical} — contains literal credentials (use \${VAR} placeholders)`);
          continue;
        }
        servers[name] = config;
      }
    } else {
      throw new Error(
        `${canonical} exists but could not be parsed. Fix or remove it before upgrading.`,
      );
    }
    importServersFromFile(join(workspace, ".agents", "mcp.json"), rootConfig, servers, { onlyMissing: true });
    importServersFromFile(join(workspace, ".mcp.json"), rootConfig, servers, { onlyMissing: true });
    importServersFromFile(join(workspace, ".cursor", "mcp.json"), rootConfig, servers, { onlyMissing: true });
  } else {
    importServersFromFile(join(workspace, ".agents", "mcp.json"), rootConfig, servers);
    importServersFromFile(join(workspace, ".mcp.json"), rootConfig, servers);
    importServersFromFile(join(workspace, ".cursor", "mcp.json"), rootConfig, servers);
    const vscodeMcp = join(rootConfig, ".vscode", "mcp.json");
    importServersFromFile(vscodeMcp, rootConfig, servers);
  }

  return servers;
}

/**
 * Merge template (bundled) MCP servers with user servers.
 *
 * Precedence:
 * - Servers only in `user` are preserved (e.g. a personal `github` entry).
 * - Servers in `template` always win on name overlap — bundled servers like
 *   `context7` refresh from aiworkspace on `npm run upgrade`.
 *
 * To override a bundled server locally, use per-project MCP config
 * (`<project>/.cursor/mcp.json`, nearest-wins) rather than editing canonical.
 */
function mergeServers(template, user) {
  const merged = {};
  for (const [name, config] of Object.entries(user)) {
    if (!(name in template)) merged[name] = config;
  }
  return { ...merged, ...template };
}

function codexKeySegment(segment) {
  return /^[A-Za-z0-9_-]+$/.test(segment) ? segment : JSON.stringify(segment);
}

function codexServerTable(name, suffix = "") {
  let table = `mcp_servers.${codexKeySegment(name)}`;
  if (suffix) table += `.${suffix}`;
  return table;
}

function serverToCodexSection(name, config) {
  if (config.type !== "stdio" || !config.command) return null;
  const lines = [
    `[${codexServerTable(name)}]`,
    `command = ${JSON.stringify(config.command)}`,
  ];
  if (config.args?.length) lines.push(`args = ${JSON.stringify(config.args)}`);
  if (config.env && Object.keys(config.env).length) {
    lines.push("");
    lines.push(`[${codexServerTable(name, "env")}]`);
    for (const [k, v] of Object.entries(config.env)) {
      lines.push(`${codexKeySegment(k)} = ${JSON.stringify(String(v))}`);
    }
  }
  return lines.join("\n");
}

/** Emit Codex TOML as a projection of merged JSON (preamble preserved, MCP sections regenerated). */
function emitCodexToml(merged, existingToml = "") {
  const mcpMarker = existingToml.match(/^[\s\S]*?(?=^\[mcp_servers\.)/m);
  const preamble = mcpMarker ? mcpMarker[0].trimEnd() : existingToml.trimEnd();
  const blocks = [];
  for (const [name, config] of Object.entries(merged)) {
    const block = serverToCodexSection(name, config);
    if (block) blocks.push(block);
  }
  const body = blocks.join("\n\n");
  if (!body) return preamble ? `${preamble}\n` : "";
  return (preamble ? `${preamble}\n\n` : "") + `${body}\n`;
}

/**
 * Scaffold and merge MCP configs. Returns git-relative paths that changed.
 */
export function upgradeMcp({ templateRoot, repoDir = REPO_DIR }) {
  if (!templateRoot || !existsSync(templateRoot)) {
    console.log("\n⚠ MCP template not found — skipping MCP upgrade.\n");
    return { changedPaths: [] };
  }

  const templateLoad = loadTemplateServers(templateRoot);
  if ("invalid" in templateLoad) {
    console.warn(`\n⚠ ${templateLoad.invalid} exists but could not be parsed — skipping MCP upgrade.\n`);
    return { changedPaths: [] };
  }
  if ("missing" in templateLoad) {
    console.warn(`\n⚠ ${templateLoad.missing} not found in MCP template — skipping MCP upgrade.\n`);
    return { changedPaths: [] };
  }

  const rootConfig = join(repoDir, "root-config");
  const workspace = resolve(repoDir, "..");
  const canonical = join(rootConfig, ".agents", "mcp.json");
  const mcpRootSymlink = join(rootConfig, ".mcp.json");
  const cursorMcp = join(rootConfig, ".cursor", "mcp.json");
  const codexToml = join(rootConfig, ".codex", "config.toml");
  const vscodeMcp = join(rootConfig, ".vscode", "mcp.json");

  const templateServers = templateLoad.servers;
  const userServers = collectUserServers(workspace, rootConfig);
  const merged = mergeServers(templateServers, userServers);
  const changedPaths = [];
  const rel = (p) => relative(repoDir, p).replaceAll("\\", "/");

  console.log("\n🔌 Upgrading MCP configs...\n");

  const added = Object.keys(templateServers).filter((k) => !(k in userServers));
  const refreshed = Object.keys(templateServers).filter((k) => k in userServers);
  const kept = Object.keys(userServers).filter((k) => !(k in templateServers));
  for (const name of added) console.log(`  + ${name} (from template)`);
  for (const name of refreshed) console.log(`  ↻ refreshed ${name} (bundled)`);
  for (const name of kept) console.log(`  ✓ kept ${name} (user)`);

  ensureDir(join(rootConfig, ".agents"));
  const canonicalBefore = existsSync(canonical) ? readFileSync(canonical, "utf8") : null;
  const canonicalNext = JSON.stringify({ mcpServers: merged }, null, 2) + "\n";
  if (canonicalBefore !== canonicalNext) {
    writeFileSync(canonical, canonicalNext);
    changedPaths.push(rel(canonical));
    console.log(`  ✓ ${rel(canonical)}`);
  }

  if (safeSymlink(".agents/mcp.json", mcpRootSymlink, { replace: true, copyFallback: false, quiet: true })) {
    changedPaths.push(rel(mcpRootSymlink));
    console.log(`  ✓ ${rel(mcpRootSymlink)} → .agents/mcp.json`);
  }

  ensureDir(join(rootConfig, ".cursor"));
  if (safeSymlink("../.agents/mcp.json", cursorMcp, { replace: true, copyFallback: false, quiet: true })) {
    changedPaths.push(rel(cursorMcp));
    console.log(`  ✓ ${rel(cursorMcp)} → ../.agents/mcp.json`);
  }

  const templateCodex = join(templateRoot, ".codex", "config.toml");
  ensureDir(join(rootConfig, ".codex"));
  const codexPreamble = existsSync(codexToml)
    ? readFileSync(codexToml, "utf8")
  : existsSync(templateCodex)
    ? readFileSync(templateCodex, "utf8")
    : "";
  const codexOut = emitCodexToml(merged, codexPreamble);
  if (!existsSync(codexToml) || readFileSync(codexToml, "utf8") !== codexOut) {
    writeFileSync(codexToml, codexOut);
    changedPaths.push(rel(codexToml));
    console.log(`  ✓ ${rel(codexToml)} (from merged)`);
  }

  ensureDir(join(rootConfig, ".vscode"));
  const vscodeOut = JSON.stringify({ servers: merged }, null, 2) + "\n";
  if (!existsSync(vscodeMcp) || readFileSync(vscodeMcp, "utf8") !== vscodeOut) {
    writeFileSync(vscodeMcp, vscodeOut);
    changedPaths.push(rel(vscodeMcp));
    console.log(`  ✓ ${rel(vscodeMcp)} (from merged)`);
  }

  console.log("");
  return { changedPaths };
}
