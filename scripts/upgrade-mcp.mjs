#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * upgrade-mcp.mjs — Scaffold and merge MCP configs during npm run sync.
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, unlinkSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  REPO_DIR, readMcpJson, isImportableMcpFile, ensureDir, safeSymlink,
  isSymlink, isFile, MCP_TEMPLATE_REL_PATHS,
  collectMcpPlaceholders, hasMcpPlaceholder, mcpLoadEnvRel, isMcpLoadEnvWrapped,
  extractEnvKeyMaps, parseOnlyVarsFromWrappedArgs, serverKind,
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

/**
 * Reverse wrapStdioWithEnvLoader: recover the inner command/args and the env
 * placeholders the wrapper absorbed into its `--map` pairs.
 *
 * Wrapping used to be one-way (`isAlreadyWrapped` short-circuited every later pass), so a
 * wrapper froze on first sync: adding a secret left `--only` stale, removing the last one
 * left the server wrapped forever, and renaming the repo dir left it pointing at a dead
 * path. Unwrapping first makes the whole transform idempotent and self-healing.
 */
export function unwrapStdioEnvLoader(config) {
  if (!isAlreadyWrapped(config)) return config;
  const args = config.args ?? [];
  const execIdx = args.indexOf("--exec");
  const sep = args.indexOf("--", execIdx === -1 ? 0 : execIdx);
  if (execIdx === -1 || sep === -1 || sep + 1 >= args.length) return config;

  const next = { ...config, command: args[sep + 1], args: args.slice(sep + 2) };
  if (!next.args.length) delete next.args;

  // Restore only what the wrapper absorbed. An entry the user has since edited by hand
  // (swapping ${FIRST_TOKEN} for ${SECOND_TOKEN}) is already present and must win — so a
  // key already in env is never overwritten, and its now-stale source var is not revived.
  const env = { ...(config.env ?? {}) };
  const mappedVars = new Set();
  for (let i = 0; i < execIdx; i++) {
    if (args[i] !== "--map" || !args[i + 1]) continue;
    const entry = args[++i];
    const at = entry.indexOf(":");
    if (at <= 0) continue;
    const childKey = entry.slice(0, at);
    const sourceVar = entry.slice(at + 1);
    mappedVars.add(sourceVar);
    if (!(childKey in env)) env[childKey] = `\${${sourceVar}}`;
  }
  // A var whose child key matched its own name carries no --map pair, so --only is the
  // only record of it. Skip the ones already explained by a --map pair or by the args.
  const inArgs = collectMcpPlaceholders(next.args ?? []);
  for (const name of parseOnlyVarsFromWrappedArgs(args) ?? []) {
    if (name in env || mappedVars.has(name) || inArgs.has(name)) continue;
    env[name] = `\${${name}}`;
  }
  next.env = Object.keys(env).length ? env : undefined;
  if (!next.env) delete next.env;
  return next;
}

export function wrapStdioWithEnvLoader(config, { repoDir = REPO_DIR } = {}) {
  if (!isServerConfig(config) || serverKind(config) !== "stdio" || isAlreadyWrapped(config)) {
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

/**
 * Wrap stdio servers that use ${VAR} placeholders with the env loader.
 *
 * Unwrap first, so the wrapper is rebuilt from the current config on every sync rather
 * than frozen at its first shape. Servers are normalized to an explicit `type` — a bare
 * `{ command, args }` is the standard Claude Code / Cursor shape and must not slip past
 * the wrap (raw ${VAR} in a committed file) or out of the Codex twin.
 */
export function applySecretTransforms(servers, { repoDir = REPO_DIR } = {}) {
  const out = {};
  for (const [name, config] of Object.entries(servers)) {
    if (!isServerConfig(config)) {
      out[name] = config;
      continue;
    }

    const kind = serverKind(config);
    let next = unwrapStdioEnvLoader({ ...config });
    if (kind) next = { ...next, type: kind };
    if (kind === "stdio" && needsSecrets(next)) {
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

/**
 * Secret-ish config keys, matched on delimiter boundaries.
 *
 * Anchoring matters: an unanchored `token` also matches MAX_TOKENS, TOKEN_PATH and
 * TOKENIZER, so a benign `{ MAX_TOKENS: "4096" }` was flagged as a literal credential.
 * Singular only — TOKENS is a count, TOKEN is a secret.
 */
const SECRET_KEY_PATTERN = /(^|[_-])(password|credential|credentials|secret|token|authorization|auth|api[_-]?key|apikey|access[_-]?key|pat)([_-]|$)/i;

/** Shapes of well-known credentials, for values whose key gives nothing away (args, url). */
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/;

/** Values that are plainly not credentials, however secret-ish the key looks. */
function isBenignValue(value) {
  return /^(\d+|true|false|null)$/i.test(value.trim());
}

function isServerConfig(config) {
  return config !== null && typeof config === "object" && !Array.isArray(config);
}

/**
 * True when a server carries a credential inline rather than a ${VAR} placeholder.
 *
 * Scans env/headers by key, and args/url by value shape — a token pasted into
 * `args: ["--api-key", "sk-live-…"]` or a `?token=` query string is the common case
 * and used to sail straight through into the committed twins.
 */
function hasLiteralCredentials(serverConfig) {
  if (!isServerConfig(serverConfig)) return false;

  const isLiteral = (v) => typeof v === "string" && v.length > 0 && !v.includes("${");

  const hasSuspiciousEntries = (obj) => {
    if (!obj || typeof obj !== "object") return false;
    return Object.entries(obj).some(
      ([k, v]) => SECRET_KEY_PATTERN.test(k) && isLiteral(v) && !isBenignValue(v),
    );
  };

  const auth = serverConfig.headers?.Authorization;
  if (typeof auth === "string" && /^Bearer\s+\S/i.test(auth) && !auth.includes("${")) {
    return true;
  }
  if (hasSuspiciousEntries(serverConfig.env) || hasSuspiciousEntries(serverConfig.headers)) {
    return true;
  }

  const args = Array.isArray(serverConfig.args) ? serverConfig.args : [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!isLiteral(arg)) continue;
    if (SECRET_VALUE_PATTERN.test(arg)) return true;
    // --api-key sk-… / --token=… — flag the value following a secret-ish flag.
    const inline = arg.match(/^--?([A-Za-z0-9_-]+)=(.+)$/);
    if (inline && SECRET_KEY_PATTERN.test(inline[1]) && !isBenignValue(inline[2])) return true;
    const flag = arg.match(/^--?([A-Za-z0-9_-]+)$/);
    if (flag && SECRET_KEY_PATTERN.test(flag[1])) {
      const next = args[i + 1];
      if (isLiteral(next) && !next.startsWith("-") && !isBenignValue(next)) return true;
    }
  }

  // Scan any string url — not just fully-literal ones. A url mixing a ${VAR} placeholder
  // with a real token (`https://…/${HOST}?token=ghp_…`) must not skip the whole check;
  // only the individual query value that is itself a placeholder is treated as non-literal.
  if (typeof serverConfig.url === "string" && serverConfig.url) {
    if (SECRET_VALUE_PATTERN.test(serverConfig.url)) return true;
    const query = serverConfig.url.split("?")[1];
    if (query) {
      for (const pair of query.split("&")) {
        const [k, v = ""] = pair.split("=");
        if (SECRET_KEY_PATTERN.test(k) && v && !v.includes("${") && !isBenignValue(v)) return true;
      }
    }
  }

  return false;
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
    // Imported files (a personal parent-root .cursor/mcp.json, a hand-written .mcp.json)
    // may carry Cursor's ${env:VAR} syntax — normalize to canonical's bare ${VAR} so this
    // import path can't silently reintroduce the syntax that breaks Claude Code.
    servers[name] = normalizeToBarePlaceholderDeep(config);
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
        // Keep it. Canonical is rewritten from the merged set, so dropping a server here
        // deletes it from the user's own file (and stages the deletion) — which does not
        // un-commit the credential, it just destroys config. Warn instead; the guard's job
        // is to stop new secrets being imported into canonical, below.
        if (hasLiteralCredentials(config)) {
          console.warn(`  ⚠ "${name}" in ${canonical} contains literal credentials — move them to \${VAR} placeholders + .env.local`);
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
    // .mcp.json is normally a symlink to canonical (isImportableMcpFile skips those). When
    // it's a *real* file, a user hand-wrote servers into it — read them before
    // ensureMcpEntryLink replaces the file with a symlink, or they are lost.
    // .cursor/mcp.json is *always* a generated twin now (like .vscode/mcp.json), never
    // read back here — its content is toCursorServers(merged), not user-authored.
    importServersFromFile(join(rootConfig, ".mcp.json"), rootConfig, servers, { onlyMissing: true });
  } else {
    importServersFromFile(join(workspace, ".agents", "mcp.json"), rootConfig, servers);
    importServersFromFile(join(workspace, ".mcp.json"), rootConfig, servers);
    importServersFromFile(join(workspace, ".cursor", "mcp.json"), rootConfig, servers);
    importServersFromFile(join(rootConfig, ".mcp.json"), rootConfig, servers);
    importServersFromFile(join(rootConfig, ".cursor", "mcp.json"), rootConfig, servers);
    const vscodeMcp = join(rootConfig, ".vscode", "mcp.json");
    importServersFromFile(vscodeMcp, rootConfig, servers);
  }

  return servers;
}

/**
 * Bundled servers the team may customize in canonical — if already present, sync
 * must not overwrite them (e.g. context7 transport or OAuth endpoint).
 */
const PRESERVE_USER_BUNDLED = new Set(["context7"]);

/**
 * Merge template (bundled) MCP servers with user servers.
 *
 * Precedence:
 * - Servers only in `user` are preserved (e.g. a personal MCP entry).
 * - Bundled servers in `PRESERVE_USER_BUNDLED` are kept when the team already
 *   defined them in canonical (sync does not clobber custom context7).
 * - Other servers in `template` win on name overlap.
 *
 * To override a non-preserved bundled server locally, use per-project MCP config
 * (`<project>/.cursor/mcp.json`, nearest-wins) rather than editing canonical.
 */
function mergeServers(template, user, disabled = []) {
  const off = new Set(disabled);
  const merged = {};
  for (const [name, config] of Object.entries(user)) {
    if (!(name in template) || PRESERVE_USER_BUNDLED.has(name)) merged[name] = config;
  }
  for (const [name, config] of Object.entries(template)) {
    if (off.has(name)) continue;
    if (PRESERVE_USER_BUNDLED.has(name) && name in user) continue;
    merged[name] = config;
  }
  for (const name of off) delete merged[name];
  return merged;
}

/**
 * Names a workspace has opted out of, from `.agents/mcp-disabled.json`.
 *
 * Deleting a bundled server from canonical cannot express intent — sync can't tell a
 * deliberate removal from a first-time consumer who simply hasn't got it yet, so it
 * resurrects the server (and stages it). The opt-out lives in a sibling file rather than
 * canonical because canonical *is* `.mcp.json` via symlink: an extra top-level key risks
 * editor schema rejection, and anything left under `mcpServers` would still be launched
 * by Claude Code. A disabled server must be absent entirely.
 */
export function readDisabledServers(rootConfig) {
  const path = join(rootConfig, ".agents", "mcp-disabled.json");
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    const list = Array.isArray(data) ? data : data?.disabled;
    if (!Array.isArray(list)) return [];
    return list.filter((n) => typeof n === "string" && n);
  } catch {
    console.warn(`  ⚠ ${path} could not be parsed — ignoring MCP opt-outs`);
    return [];
  }
}

function codexKeySegment(segment) {
  return /^[A-Za-z0-9_-]+$/.test(segment) ? segment : JSON.stringify(segment);
}

function codexServerTable(name, suffix = "") {
  let table = `mcp_servers.${codexKeySegment(name)}`;
  if (suffix) table += `.${suffix}`;
  return table;
}

/** TOML arrays are conventionally spaced; JSON.stringify is not, which churned the twin. */
function tomlArray(values) {
  return `[${values.map((v) => JSON.stringify(String(v))).join(", ")}]`;
}

function serverToCodexSection(name, config) {
  if (serverKind(config) !== "stdio" || !config.command) return null;
  const lines = [
    `[${codexServerTable(name)}]`,
    `command = ${JSON.stringify(config.command)}`,
  ];
  if (config.args?.length) lines.push(`args = ${tomlArray(config.args)}`);
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
  if (serverKind(config) !== "http" || !config.url) return null;
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

/**
 * Transform canonical bare ${VAR} placeholders to the ${env:VAR} syntax that VS Code and
 * Cursor both require for MCP config interpolation (Claude Code requires the opposite —
 * bare ${VAR} — so canonical stays in that form and only these two editor twins transform
 * it). Already-prefixed ${env:VAR} values pass through unchanged.
 */
const ENV_PREFIX_PLACEHOLDER = /(?<!\$)\$\{(?!env:)([A-Za-z_][A-Za-z0-9_]*)\}/g;

function transformEnvPrefixValue(value) {
  if (typeof value !== "string") return value;
  return value.replace(ENV_PREFIX_PLACEHOLDER, "${env:$1}");
}

function transformEnvPrefixDeep(value) {
  if (typeof value === "string") return transformEnvPrefixValue(value);
  if (Array.isArray(value)) return value.map(transformEnvPrefixDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = transformEnvPrefixDeep(v);
    return out;
  }
  return value;
}

/**
 * Inverse of the transform above — strips ${env:VAR} down to canonical's bare ${VAR}.
 * Applied to anything folded into canonical from an external file (a parent-root
 * .cursor/mcp.json, a hand-written .mcp.json, etc.): those files may legitimately carry
 * Cursor's ${env:VAR} syntax, but canonical itself must stay bare or Claude Code's native
 * resolution breaks — the same incident this whole transform pair exists to prevent.
 */
function normalizeToBarePlaceholderDeep(value) {
  if (typeof value === "string") return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, "${$1}");
  if (Array.isArray(value)) return value.map(normalizeToBarePlaceholderDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeToBarePlaceholderDeep(v);
    return out;
  }
  return value;
}

export function toVscodeServers(merged) {
  const out = {};
  for (const [name, config] of Object.entries(merged)) {
    let c = transformEnvPrefixDeep(config);
    const kind = serverKind(c);
    const needsEnvFile = (kind === "stdio" && isAlreadyWrapped(c))
      || (kind === "http" && needsSecrets(c));
    if (needsEnvFile) {
      c = { ...c, envFile: VSCODE_ENV_FILE };
    }
    out[name] = c;
  }
  return out;
}

/**
 * Project merged servers to Cursor's twin. Cursor resolves ${env:VAR} in HTTP headers from
 * the real process environment at startup, not from an envFile (see setup.md §4.1) — so
 * unlike the VS Code twin, no envFile is added here, just the placeholder syntax transform.
 */
export function toCursorServers(merged) {
  const out = {};
  for (const [name, config] of Object.entries(merged)) {
    out[name] = transformEnvPrefixDeep(config);
  }
  return out;
}

/**
 * Split TOML into the preamble plus top-level table blocks, dropping the MCP ones.
 *
 * Everything after the first `[mcp_servers.*]` table used to be discarded wholesale, so a
 * team that appended `[profiles.fast]` or `[projects."/x"]` below the generated blocks lost
 * it on the next sync. Only `mcp_servers` tables are ours to regenerate; keep the rest.
 */
export function stripCodexMcpTables(toml) {
  const lines = toml.split("\n");
  const kept = [];
  let dropping = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[\[?\s*([^\]\s]+)/);
    if (header) {
      const table = header[1].replace(/^"|"$/g, "");
      dropping = table === "mcp_servers" || table.startsWith("mcp_servers.");
    }
    if (!dropping) kept.push(line);
  }
  return kept.join("\n").trimEnd();
}

/** Emit Codex TOML as a projection of merged JSON (user tables preserved, MCP sections regenerated). */
function emitCodexToml(merged, existingToml = "") {
  let preamble = stripCodexMcpTables(existingToml);

  const hasHttp = Object.values(merged).some((c) => serverKind(c) === "http" && c.url);
  if (hasHttp) preamble = ensureCodexRmcpFlag(preamble);

  const blocks = [];
  const oauthLogin = [];
  for (const [name, config] of Object.entries(merged)) {
    const block = serverToCodexSection(name, config) ?? serverToCodexHttpSection(name, config);
    if (block) blocks.push(block);
    if (serverKind(config) === "http" && config.url && !codexBearerVar(config)) {
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
  const disabled = readDisabledServers(rootConfig);
  const userServers = collectUserServers(workspace, rootConfig);
  const merged = applySecretTransforms(
    mergeServers(templateServers, userServers, disabled),
    { repoDir },
  );
  const changedPaths = [];
  const rel = (p) => relative(repoDir, p).replaceAll("\\", "/");

  console.log("\n🔌 Upgrading MCP configs...\n");

  const off = new Set(disabled);
  const added = Object.keys(templateServers).filter((k) => !(k in userServers) && !off.has(k));
  const refreshed = Object.keys(templateServers).filter((k) => {
    if (!(k in userServers) || off.has(k)) return false;
    return !PRESERVE_USER_BUNDLED.has(k);
  });
  const keptBundled = Object.keys(templateServers).filter((k) =>
    PRESERVE_USER_BUNDLED.has(k) && k in userServers && !off.has(k),
  );
  const kept = Object.keys(userServers).filter((k) => !(k in templateServers) && !off.has(k));
  for (const name of added) console.log(`  + ${name} (from template)`);
  for (const name of refreshed) console.log(`  ↻ refreshed ${name} (bundled)`);
  for (const name of keptBundled) console.log(`  ✓ kept ${name} (user overrides bundled)`);
  for (const name of kept) console.log(`  ✓ kept ${name} (user)`);
  for (const name of off) console.log(`  ⊘ ${name} (disabled via .agents/mcp-disabled.json)`);

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
  // Migration from the old symlink-to-canonical scheme: writeFileSync follows symlinks, so
  // writing through a stale `.cursor/mcp.json -> ../.agents/mcp.json` link here would
  // silently overwrite canonical with Cursor-transformed content instead of replacing the
  // link. Unlink it first — the twin below is a real file from here on, like .vscode/mcp.json.
  if (isSymlink(cursorMcp)) unlinkSync(cursorMcp);
  const cursorOut = JSON.stringify({ mcpServers: toCursorServers(merged) }, null, 2) + "\n";
  if (!existsSync(cursorMcp) || readFileSync(cursorMcp, "utf8") !== cursorOut) {
    writeFileSync(cursorMcp, cursorOut);
    changedPaths.push(rel(cursorMcp));
    console.log(`  ✓ ${rel(cursorMcp)} (from merged)`);
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
