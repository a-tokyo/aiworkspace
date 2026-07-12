#!/usr/bin/env node

/**
 * @managed by aiworkspace — see scripts/README.md before editing.
 *
 * Load parent-root .env.local and either exec a child (stdio MCP) or print HTTP headers JSON.
 * Stdlib only — no extra npm dependencies.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = dirname(SCRIPT_DIR);
const WORKSPACE = dirname(REPO_DIR);
const ENV_LOCAL = join(WORKSPACE, ".env.local");

/**
 * Parse .env.local content.
 *
 * Handles the shapes people actually write: an `export ` prefix (pasted from a shell
 * profile), inline `# comments`, and quoted values. Each of these used to corrupt the
 * value silently — `FOO="tok" # note` yielded `"tok" # note`, quotes and all — which
 * surfaces much later as a baffling auth failure inside an MCP server.
 *
 * Not supported: values spanning multiple lines. Escapes (\n, \t, \\, \") are unescaped
 * inside double quotes, which covers the PEM-key case.
 */
export function parseDotenv(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const withoutExport = trimmed.replace(/^export\s+/, "");
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const rest = withoutExport.slice(eq + 1).trim();

    let val;
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      // Find the closing quote, skipping escaped ones — a double-quoted value may contain
      // \" (we unescape it below), so a plain indexOf would terminate on it and truncate.
      let close = -1;
      for (let i = 1; i < rest.length; i++) {
        if (quote === '"' && rest[i] === "\\") { i++; continue; }
        if (rest[i] === quote) { close = i; break; }
      }
      if (close === -1) {
        // Unterminated quote — take the remainder verbatim rather than mangling it.
        val = rest.slice(1);
      } else {
        val = rest.slice(1, close);
        if (quote === '"') {
          val = val.replace(/\\([nrt\\"])/g, (_, c) =>
            ({ n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"' })[c]);
        }
      }
    } else {
      // Unquoted: an inline comment needs whitespace before the #, so a value like
      // `p@ss#word` survives intact.
      const comment = rest.search(/\s#/);
      val = (comment === -1 ? rest : rest.slice(0, comment)).trim();
    }

    out[key] = val;
  }
  return out;
}

/** Expand ${VAR} / ${env:VAR} against the resolved env. */
export function expandPlaceholders(value, env) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) =>
    (env[name] !== undefined ? env[name] : match));
}

export function loadEnvLocal(path = ENV_LOCAL) {
  if (!existsSync(path)) return {};
  return parseDotenv(readFileSync(path, "utf8"));
}

function resolveEnvVar(varName, fileEnv, shellEnv = process.env) {
  if (fileEnv[varName]) return fileEnv[varName];
  if (shellEnv[varName]) return shellEnv[varName];
  return undefined;
}

export function buildChildEnv(fileEnv, { only = null, maps = [] } = {}) {
  const childEnv = { ...process.env };
  // Default-deny: without --only/--map, every secret in .env.local used to be handed to
  // the child process. Generated wrappers always pass --only, so nothing legitimate needs
  // the blanket injection.
  if (!only?.length && !maps.length) {
    console.error("mcp-load-env: no --only/--map given — passing no .env.local vars to the child");
    return childEnv;
  }
  for (const name of only ?? []) {
    const val = resolveEnvVar(name, fileEnv);
    if (val !== undefined) childEnv[name] = val;
  }
  for (const entry of maps) {
    const sep = entry.indexOf(":");
    if (sep <= 0) continue;
    const childKey = entry.slice(0, sep).trim();
    const sourceVar = entry.slice(sep + 1).trim();
    if (!childKey || !sourceVar) continue;
    const val = resolveEnvVar(sourceVar, fileEnv);
    if (val !== undefined) childEnv[childKey] = val;
  }
  return childEnv;
}

function parseArgs(argv) {
  const execIdx = argv.indexOf("--exec");
  if (execIdx !== -1) {
    const sep = argv.indexOf("--", execIdx);
    if (sep === -1 || sep + 1 >= argv.length) {
      console.error("mcp-load-env: --exec requires -- <command> [args…]");
      process.exit(1);
    }
    let only = null;
    const onlyIdx = argv.indexOf("--only");
    if (onlyIdx !== -1 && onlyIdx < execIdx && argv[onlyIdx + 1]) {
      only = argv[onlyIdx + 1].split(",").map((s) => s.trim()).filter(Boolean);
    }
    const maps = [];
    for (let i = 0; i < execIdx; i++) {
      if (argv[i] === "--map" && argv[i + 1]) maps.push(argv[++i]);
    }
    return { mode: "exec", command: argv[sep + 1], args: argv.slice(sep + 2), only, maps };
  }

  let headerName = null;
  let varName = null;
  let prefix = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--headers" && argv[i + 1]) headerName = argv[++i];
    else if (argv[i] === "--var" && argv[i + 1]) varName = argv[++i];
    else if (argv[i] === "--prefix" && argv[i + 1]) prefix = argv[++i];
  }
  if (!headerName || !varName) {
    console.error("mcp-load-env: --headers <Name> --var <ENV_KEY> [--prefix <text>]");
    process.exit(1);
  }
  return { mode: "headers", headerName, varName, prefix };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fileEnv = loadEnvLocal();

  if (opts.mode === "headers") {
    const val = resolveEnvVar(opts.varName, fileEnv) ?? "";
    if (!val) process.exit(0);
    const headerVal = `${opts.prefix}${val}`;
    process.stdout.write(JSON.stringify({ [opts.headerName]: headerVal }));
    return;
  }

  const childEnv = buildChildEnv(fileEnv, { only: opts.only, maps: opts.maps });

  // The loader only ever set env vars, so a placeholder written into args (e.g.
  // `--api-key ${FOO_TOKEN}`) reached the child as the literal string "${FOO_TOKEN}"
  // while check-secrets happily reported it satisfied. Expand argv too.
  const command = expandPlaceholders(opts.command, childEnv);
  const args = opts.args.map((a) => expandPlaceholders(a, childEnv));

  // On Windows a shell is needed to run `npx`-style .cmd shims, but it also re-parses
  // command and args through cmd.exe — so a metacharacter in mcp.json would execute.
  // Refuse rather than run it.
  const useShell = process.platform === "win32";
  if (useShell) {
    const unsafe = [command, ...args].find((v) => /[&|<>^%"]/.test(v));
    if (unsafe !== undefined) {
      console.error(`mcp-load-env: refusing to run — shell metacharacters in "${unsafe}"`);
      process.exit(1);
    }
  }

  const r = spawnSync(command, args, {
    env: childEnv,
    stdio: "inherit",
    shell: useShell,
  });
  if (r.error) {
    console.error(`mcp-load-env: ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

const cliArgv = process.argv.slice(2);
if (cliArgv.includes("--exec") || cliArgv.includes("--headers")) {
  main();
}
