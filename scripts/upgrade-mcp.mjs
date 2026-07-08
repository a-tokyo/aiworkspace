#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * upgrade-mcp.mjs — Scaffold and merge MCP configs during npm run upgrade.
 */

import {
  existsSync, readFileSync, writeFileSync, symlinkSync,
  readlinkSync, cpSync, copyFileSync, mkdtempSync, lstatSync, rmSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  REPO_DIR, readMcpJson, isImportableMcpFile, ensureDir, SYMLINK_TYPE, isSymlink,
} from "./lib.mjs";

const TEMPLATE_FILES = [
  join(".agents", "mcp.json"),
  join(".codex", "config.toml"),
  join(".vscode", "mcp.json"),
];

/** Materialize root-config MCP template files from git upstream into a temp dir. */
export function materializeGitTemplateRoot(repoDir = REPO_DIR) {
  const tmp = mkdtempSync(join(tmpdir(), "aiws-mcp-template-"));
  for (const rel of TEMPLATE_FILES) {
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
  if (!existsSync(path)) return {};
  return readMcpJson(path)?.mcpServers ?? {};
}

const SECRET_KEY_PATTERN = /token|secret|password|credential|pat|apikey|api_key|authorization/i;

/**
 * Returns true if a server config contains literal credential values
 * (secret-looking keys with values that don't use ${PLACEHOLDER} syntax).
 */
function hasLiteralCredentials(serverConfig) {
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

function collectUserServers(workspace, rootConfig) {
  const servers = {};
  const canonical = join(rootConfig, ".agents", "mcp.json");

  if (existsSync(canonical)) {
    const parsed = readMcpJson(canonical);
    if (parsed) {
      Object.assign(servers, parsed.mcpServers);
    } else {
      throw new Error(
        `${canonical} exists but could not be parsed. Fix or remove it before upgrading.`,
      );
    }
  } else {
    const parentCandidates = [
      join(workspace, ".agents", "mcp.json"),
      join(workspace, ".mcp.json"),
      join(workspace, ".cursor", "mcp.json"),
    ];
    for (const path of parentCandidates) {
      if (!isImportableMcpFile(path, rootConfig)) continue;
      const parsed = readMcpJson(path);
      if (!parsed) continue;
      for (const [name, config] of Object.entries(parsed.mcpServers)) {
        if (hasLiteralCredentials(config)) {
          console.warn(`  ⚠ Skipping "${name}" from ${path} — contains literal credentials (use \${VAR} placeholders)`);
          continue;
        }
        servers[name] = config;
      }
    }
  }

  return servers;
}

function mergeServers(template, user) {
  return { ...template, ...user };
}

function extractCodexSections(toml) {
  const sections = new Map();
  const lines = toml.split("\n");
  let current = null;
  let buf = [];

  for (const line of lines) {
    const m = line.match(/^\[mcp_servers\.([^\]]+)\]/);
    if (m) {
      if (current) sections.set(current, buf.join("\n"));
      current = m[1];
      buf = [line];
    } else if (current && /^\[/.test(line)) {
      sections.set(current, buf.join("\n").trimEnd());
      current = null;
      buf = [];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) sections.set(current, buf.join("\n").trimEnd());
  return sections;
}

function appendMissingCodexSections(existing, template) {
  const existingSections = extractCodexSections(existing);
  const templateSections = extractCodexSections(template);
  let out = existing.trimEnd();
  for (const [name, block] of templateSections) {
    if (!existingSections.has(name)) {
      out += (out ? "\n\n" : "") + block;
    }
  }
  return out + "\n";
}

function serverToCodexSection(name, config) {
  if (config.type !== "stdio" || !config.command) return null;
  const lines = [`[mcp_servers.${name}]`, `command = "${config.command}"`];
  if (config.args?.length) lines.push(`args = ${JSON.stringify(config.args)}`);
  if (config.env && Object.keys(config.env).length) {
    lines.push("");
    lines.push(`[mcp_servers.${name}.env]`);
    for (const [k, v] of Object.entries(config.env)) {
      lines.push(`${k} = "${v}"`);
    }
  }
  return lines.join("\n");
}

function buildCodexFromMerged(merged, existingToml, templateToml) {
  let out = appendMissingCodexSections(existingToml.trimEnd(), templateToml);
  const sections = extractCodexSections(out);
  for (const [name, config] of Object.entries(merged)) {
    if (sections.has(name)) continue;
    const block = serverToCodexSection(name, config);
    if (block) out = out.trimEnd() + "\n\n" + block + "\n";
  }
  return out.endsWith("\n") ? out : out + "\n";
}

function collectVscodeOnlyServers(vscodeMcp, userServers) {
  if (!existsSync(vscodeMcp)) return {};
  const parsed = readMcpJson(vscodeMcp);
  if (!parsed) {
    throw new Error(
      `${vscodeMcp} exists but could not be parsed. Fix or remove it before upgrading.`,
    );
  }
  const only = {};
  for (const [name, config] of Object.entries(parsed.mcpServers)) {
    if (name in userServers) continue;
    if (hasLiteralCredentials(config)) {
      console.warn(`  ⚠ Skipping "${name}" from ${vscodeMcp} — contains literal credentials (use \${VAR} placeholders)`);
      continue;
    }
    only[name] = config;
  }
  return only;
}

function ensureSymlink(target, linkPath) {
  if (existsSync(linkPath)) {
    if (isSymlink(linkPath)) {
      if (readlinkSync(linkPath) === target) return false;
      console.warn(`  ⚠ ${linkPath} has a different target — replacing`);
    } else {
      console.warn(`  ⚠ ${linkPath} is a regular file — replacing with symlink`);
    }
    rmSync(linkPath, { recursive: true, force: true });
  }
  ensureDir(dirname(linkPath));
  try {
    symlinkSync(target, linkPath, SYMLINK_TYPE);
    return true;
  } catch {
    const absTarget = resolve(dirname(linkPath), target);
    try {
      if (lstatSync(absTarget).isDirectory()) {
        cpSync(absTarget, linkPath, { recursive: true });
      } else {
        copyFileSync(absTarget, linkPath);
      }
      console.warn(`  ⚠ Symlink failed for ${linkPath} — copied instead (not staged)`);
      return false;
    } catch (copyErr) {
      console.warn(`  ⚠ Could not symlink or copy ${linkPath}: ${copyErr.message}`);
      return false;
    }
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

  const rootConfig = join(repoDir, "root-config");
  const workspace = resolve(repoDir, "..");
  const canonical = join(rootConfig, ".agents", "mcp.json");
  const mcpRootSymlink = join(rootConfig, ".mcp.json");
  const cursorMcp = join(rootConfig, ".cursor", "mcp.json");
  const codexToml = join(rootConfig, ".codex", "config.toml");
  const vscodeMcp = join(rootConfig, ".vscode", "mcp.json");

  const templateServers = loadTemplateServers(templateRoot);
  const userServers = collectUserServers(workspace, rootConfig);
  const vscodeOnlyServers = collectVscodeOnlyServers(vscodeMcp, userServers);
  const merged = mergeServers(templateServers, { ...userServers, ...vscodeOnlyServers });
  const changedPaths = [];
  const rel = (p) => p.slice(repoDir.length + 1);

  console.log("\n🔌 Upgrading MCP configs...\n");

  const added = Object.keys(templateServers).filter((k) => !(k in userServers) && !(k in vscodeOnlyServers));
  const kept = [...new Set([...Object.keys(userServers), ...Object.keys(vscodeOnlyServers)])];
  for (const name of added) console.log(`  + ${name} (from template)`);
  for (const name of kept) console.log(`  ✓ kept ${name} (user)`);

  ensureDir(join(rootConfig, ".agents"));
  const canonicalBefore = existsSync(canonical) ? readFileSync(canonical, "utf8") : null;
  const canonicalNext = JSON.stringify({ mcpServers: merged }, null, 2) + "\n";
  if (canonicalBefore !== canonicalNext) {
    writeFileSync(canonical, canonicalNext);
    changedPaths.push(rel(canonical));
    console.log(`  ✓ ${rel(canonical)}`);
  }

  if (ensureSymlink(".agents/mcp.json", mcpRootSymlink)) {
    changedPaths.push(rel(mcpRootSymlink));
    console.log(`  ✓ ${rel(mcpRootSymlink)} → .agents/mcp.json`);
  }

  ensureDir(join(rootConfig, ".cursor"));
  if (ensureSymlink("../.agents/mcp.json", cursorMcp)) {
    changedPaths.push(rel(cursorMcp));
    console.log(`  ✓ ${rel(cursorMcp)} → ../.agents/mcp.json`);
  }

  const templateCodex = join(templateRoot, ".codex", "config.toml");
  ensureDir(join(rootConfig, ".codex"));
  if (!existsSync(codexToml) && existsSync(templateCodex)) {
    const templateContent = readFileSync(templateCodex, "utf8");
    const codexOut = buildCodexFromMerged(merged, "", templateContent);
    writeFileSync(codexToml, codexOut);
    changedPaths.push(rel(codexToml));
    console.log(`  ✓ ${rel(codexToml)} (from template + merged)`);
  } else if (existsSync(codexToml) && existsSync(templateCodex)) {
    const before = readFileSync(codexToml, "utf8");
    const templateContent = readFileSync(templateCodex, "utf8");
    const after = buildCodexFromMerged(merged, before, templateContent);
    if (before !== after) {
      writeFileSync(codexToml, after);
      changedPaths.push(rel(codexToml));
      console.log(`  ✓ ${rel(codexToml)} (merged sections)`);
    }
  }

  const templateVscode = join(templateRoot, ".vscode", "mcp.json");
  ensureDir(join(rootConfig, ".vscode"));
  if (!existsSync(vscodeMcp) && existsSync(templateVscode)) {
    const vscodeNext = JSON.stringify({ servers: merged }, null, 2) + "\n";
    writeFileSync(vscodeMcp, vscodeNext);
    changedPaths.push(rel(vscodeMcp));
    console.log(`  ✓ ${rel(vscodeMcp)} (from template)`);
  } else if (existsSync(vscodeMcp)) {
    const vscodeOut = JSON.stringify({ servers: merged }, null, 2) + "\n";
    const before = readFileSync(vscodeMcp, "utf8");
    if (before !== vscodeOut) {
      writeFileSync(vscodeMcp, vscodeOut);
      changedPaths.push(rel(vscodeMcp));
      console.log(`  ✓ ${rel(vscodeMcp)} (merged)`);
    }
  }

  console.log("");
  return { changedPaths };
}
