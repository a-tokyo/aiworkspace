#!/bin/sh
# Load parent-root .env.local; on macOS push Bearer MCP vars to launchctl for Dock-launched Cursor.
# Sourced from shell profile via npm run mcp:install-shell.

_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
_ENV_FILE=$(CDPATH= cd -- "$_SCRIPT_DIR/../.." && pwd)/.env.local
_PATHS_FILE="$_SCRIPT_DIR/.mcp-env.paths"

[ -f "$_ENV_FILE" ] || return 0 2>/dev/null || exit 0
[ -f "$_PATHS_FILE" ] || return 0 2>/dev/null || exit 0

set -a
# shellcheck source=/dev/null
. "$_ENV_FILE"
set +a

# shellcheck source=/dev/null
. "$_PATHS_FILE"

[ -n "$AIWORKSPACE_NODE" ] && [ -x "$AIWORKSPACE_NODE" ] || return 0 2>/dev/null || exit 0

_keys=$("$AIWORKSPACE_NODE" "$_SCRIPT_DIR/mcp-bearer-env-keys.mjs") || return 0 2>/dev/null || exit 0
[ -n "$_keys" ] || return 0 2>/dev/null || exit 0

case $(uname -s) in
  Darwin) ;;
  *) return 0 2>/dev/null || exit 0 ;;
esac

command -v launchctl >/dev/null 2>&1 || return 0 2>/dev/null || exit 0

printf '%s\n' "$_keys" | while IFS= read -r _key; do
  [ -n "$_key" ] || continue
  _val=$(printenv "$_key" 2>/dev/null) || _val=
  [ -n "$_val" ] || continue
  launchctl setenv "$_key" "$_val" 2>/dev/null || true
done

unset _SCRIPT_DIR _ENV_FILE _PATHS_FILE _keys _key _val
