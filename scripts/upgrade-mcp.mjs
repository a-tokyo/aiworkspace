#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * upgrade-mcp.mjs — Scaffold and merge MCP configs during npm run sync.
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  REPO_DIR, readMcpJson, isImportableMcpFile, ensureDir, safeSymlink,
  isSymlink, isFile, MCP_TEMPLATE_REL_PATHS,
  collectMcpPlaceholders, hasMcpPlaceholder, mcpLoadEnvRel, isMcpLoadEnvWrapped,
  extractEnvKeyMaps,
} from "./lib.mjs";

export { mcpLoadEnvRel } from "./lib.mjs";

/** @deprecated Use mcpLoadEnvRel(repoDir) — kept for tests importing the old constant shape. */
export const MCP_LOAD_ENV_REL = mcpLoadEnvRel();

const VSCODE_ENV_FILE = "${workspaceFolder}/.env.local";

export function needsSecrets(config) {
  if (!isServerConfig(config)) return false;
  return collectMcpPlaceholders(config).size > 0;
}

export function isAlreadyWrapped(config) {
  return isMcpLoadEnvWrapped(config);
}

export function wrapStdioWithEnvLoader(config, { repoDir = REPO_DIR } = {}) {
  if (!isServerConfig(config) || config.type !== "stdio" || isAlreadyWrapped(config)) {
    return config;
  }
  const innerCommand = config.command;
  const innerArgs = config.args ?? [];
  const vars = [...collectMcpPlaceholders(config)];
  const loaderArgs = [mcpLoadEnvRel(repoDir)];
  if (vars.length) loaderArgs.push("--only", vars.join(","));
  for (const { childKey, sourceVar } of extractEnvKeyMaps(config.env)) {
    loaderArgs.push("--map", `${childKey}:${sourceVar}`);
  }
  loaderArgs.push("--exec", "--", innerCommand, ...innerArgs);

  const next = {
    ...config,
    type: "stdio",
    command: "node",
    args: loaderArgs,
  };
  if (next.env && Object.keys(next.env).length > 0) {
    const env = {};
    for (const [k, v] of Object.entries(next.env)) {
      if (typeof v === "string" && !hasMcpPlaceholder(v)) env[k] = v;
    }
    next.env = Object.keys(env).length ? env : undefined;
    if (!next.env) delete next.env;
  }
  return next;
}

/** Wrap stdio servers that use ${VAR} placeholders with the env loader. */
export function applySecretTransforms(servers, { repoDir = REPO_DIR } = {}) {
  const out = {};
  for (const [name, config] of Object.entries(servers)) {
    if (!isServerConfig(config)) {
      out[name] = config;
      continue;
    }

    let next = { ...config };
    if (next.type === "stdio" && needsSecrets(next)) {
      next = wrapStdioWithEnvLoader(next, { repoDir });
    }

    out[name] = next;
  }
  return out;
}

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
 * - Servers only in `user` are preserved (e.g. a personal MCP entry).
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

function codexBearerVar(config) {
  const auth = config.headers?.Authorization;
  const m = typeof auth === "string"
    && auth.match(/^Bearer\s+\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}$/);
  return m ? m[1] : null;
}

/**
 * Project an HTTP MCP server to Codex. Emits `url` for every streamable-HTTP
 * server; adds `bearer_token_env_var` when the canonical config carries a
 * Bearer ${VAR} header. OAuth-only servers get just `url` — Codex authenticates
 * them via `codex mcp login <name>` (needs experimental_use_rmcp_client = true,
 * injected into the preamble by emitCodexToml).
 */
function serverToCodexHttpSection(name, config) {
  if (config.type !== "http" || !config.url) return null;
  const lines = [
    `[${codexServerTable(name)}]`,
    `url = ${JSON.stringify(config.url)}`,
  ];
  const bearerVar = codexBearerVar(config);
  if (bearerVar) lines.push(`bearer_token_env_var = ${JSON.stringify(bearerVar)}`);
  return lines.join("\n");
}

const CODEX_RMCP_FLAG = "experimental_use_rmcp_client = true";

/**
 * Ensure the top-level rmcp flag is present in the Codex preamble. It must
 * precede the first table header, so insert it before any existing table
 * (the managed file's preamble is normally comment-only).
 */
function ensureCodexRmcpFlag(preamble) {
  if (new RegExp(`^\\s*${CODEX_RMCP_FLAG.split(" ")[0]}\\s*=`, "m").test(preamble)) {
    return preamble;
  }
  const lines = preamble ? preamble.split("\n") : [];
  const tableIdx = lines.findIndex((l) => /^\s*\[/.test(l));
  if (tableIdx === -1) {
    return preamble ? `${preamble}\n${CODEX_RMCP_FLAG}` : CODEX_RMCP_FLAG;
  }
  lines.splice(tableIdx, 0, CODEX_RMCP_FLAG, "");
  return lines.join("\n");
}

/** Transform canonical ${VAR} placeholders to VS Code ${env:VAR} syntax. */
const VSCODE_ENV_PLACEHOLDER = /(?<!\$)\$\{(?!env:)([A-Za-z_][A-Za-z0-9_]*)\}/g;

function transformVscodeValue(value) {
  if (typeof value !== "string") return value;
  return value.replace(VSCODE_ENV_PLACEHOLDER, "${env:$1}");
}

function transformVscodeDeep(value) {
  if (typeof value === "string") return transformVscodeValue(value);
  if (Array.isArray(value)) return value.map(transformVscodeDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = transformVscodeDeep(v);
    return out;
  }
  return value;
}

export function toVscodeServers(merged) {
  const out = {};
  for (const [name, config] of Object.entries(merged)) {
    let c = transformVscodeDeep(config);
    const needsEnvFile = (c.type === "stdio" && isAlreadyWrapped(c))
      || (c.type === "http" && needsSecrets(c));
    if (needsEnvFile) {
      c = { ...c, envFile: VSCODE_ENV_FILE };
    }
    out[name] = c;
  }
  return out;
}

/** Emit Codex TOML as a projection of merged JSON (preamble preserved, MCP sections regenerated). */
function emitCodexToml(merged, existingToml = "") {
  const mcpMarker = existingToml.match(/^[\s\S]*?(?=^\[mcp_servers\.)/m);
  let preamble = mcpMarker ? mcpMarker[0].trimEnd() : existingToml.trimEnd();

  const hasHttp = Object.values(merged).some((c) => c?.type === "http" && c.url);
  if (hasHttp) preamble = ensureCodexRmcpFlag(preamble);

  const blocks = [];
  const oauthLogin = [];
  for (const [name, config] of Object.entries(merged)) {
    const block = serverToCodexSection(name, config) ?? serverToCodexHttpSection(name, config);
    if (block) blocks.push(block);
    if (config?.type === "http" && config.url && !codexBearerVar(config)) {
      oauthLogin.push(name);
    }
  }
  if (oauthLogin.length) {
    const cmds = oauthLogin.map((n) => `codex mcp login ${n}`).join(", ");
    console.log(`  ℹ Codex: run one-time OAuth login for HTTP servers — ${cmds}`);
  }
  const body = blocks.join("\n\n");
  if (!body) return preamble ? `${preamble}\n` : "";
  return (preamble ? `${preamble}\n\n` : "") + `${body}\n`;
}

/** Create MCP entry symlink; copy-fallback on Windows but only stage real symlinks. */
function ensureMcpEntryLink(target, linkPath, label, rel, changedPaths) {
  if (!safeSymlink(target, linkPath, { replace: true, quiet: true })) return;
  const pathRel = rel(linkPath);
  if (isSymlink(linkPath)) {
    changedPaths.push(pathRel);
    console.log(`  ✓ ${pathRel} → ${label}`);
  } else if (isFile(linkPath)) {
    console.log(`  ✓ ${pathRel} (copied — symlink unavailable; not staged)`);
  }
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
  const merged = applySecretTransforms(mergeServers(templateServers, userServers), { repoDir });
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

  ensureMcpEntryLink(".agents/mcp.json", mcpRootSymlink, ".agents/mcp.json", rel, changedPaths);

  ensureDir(join(rootConfig, ".cursor"));
  ensureMcpEntryLink("../.agents/mcp.json", cursorMcp, "../.agents/mcp.json", rel, changedPaths);

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
  const vscodeOut = JSON.stringify({ servers: toVscodeServers(merged) }, null, 2) + "\n";
  if (!existsSync(vscodeMcp) || readFileSync(vscodeMcp, "utf8") !== vscodeOut) {
    writeFileSync(vscodeMcp, vscodeOut);
    changedPaths.push(rel(vscodeMcp));
    console.log(`  ✓ ${rel(vscodeMcp)} (from merged)`);
  }

  console.log("");
  return { changedPaths };
}

function readGitTemplateFile(repoDir, gitPath) {
  try {
    return execFileSync(
      "git", ["show", `upstream/main:${gitPath}`],
      { cwd: repoDir, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
    );
  } catch {
    return null;
  }
}

/** Scaffold .env.example in root-config/ when missing. */
export function upgradeEnvScaffold({ templateRoot, repoDir = REPO_DIR }) {
  const changedPaths = [];
  const rel = (p) => relative(repoDir, p).replaceAll("\\", "/");

  console.log("\n🔐 Scaffolding MCP secret files...\n");

  const exampleDest = join(repoDir, "root-config", ".env.example");
  if (!existsSync(exampleDest)) {
    const exampleSrc = templateRoot ? join(templateRoot, ".env.example") : null;
    const content = exampleSrc && existsSync(exampleSrc)
      ? readFileSync(exampleSrc, "utf8")
      : readGitTemplateFile(repoDir, "root-config/.env.example");
    if (content) {
      writeFileSync(exampleDest, content);
      changedPaths.push(rel(exampleDest));
      console.log(`  ✓ ${rel(exampleDest)}`);
    }
  }

  if (changedPaths.length === 0) console.log("  (no env scaffold changes)\n");
  else console.log("");
  return { changedPaths };
}
