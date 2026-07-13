#!/bin/sh
# Load parent-root .env.local; on macOS push Bearer MCP vars to launchctl for Dock-launched Cursor.
# Sourced from shell profile: . /path/workspace-env.sh /path/scripts

[ -n "$1" ] || return 0 2>/dev/null || exit 0
_SCRIPT_DIR=$1
_ENV_FILE=$(CDPATH= cd "$_SCRIPT_DIR/../.." && pwd)/.env.local
_PATHS_FILE="$_SCRIPT_DIR/.mcp-env.paths"

[ -f "$_ENV_FILE" ] || return 0 2>/dev/null || exit 0

_AIWORKSPACE_NODE=
_BEARER_KEYS=
if [ -f "$_PATHS_FILE" ]; then
  while IFS= read -r _line || [ -n "$_line" ]; do
    case $_line in
      AIWORKSPACE_NODE=*)
        _AIWORKSPACE_NODE=${_line#AIWORKSPACE_NODE=}
        case $_AIWORKSPACE_NODE in
          \"*) _AIWORKSPACE_NODE=${_AIWORKSPACE_NODE#\"}; _AIWORKSPACE_NODE=${_AIWORKSPACE_NODE%\"} ;;
        esac
        ;;
      BEARER_KEYS=*)
        _BEARER_KEYS=${_line#BEARER_KEYS=}
        ;;
    esac
  done < "$_PATHS_FILE"
fi

if [ -z "$_AIWORKSPACE_NODE" ] || [ ! -x "$_AIWORKSPACE_NODE" ]; then
  _AIWORKSPACE_NODE=$(command -v node 2>/dev/null) || _AIWORKSPACE_NODE=
fi
[ -n "$_AIWORKSPACE_NODE" ] && [ -x "$_AIWORKSPACE_NODE" ] || return 0 2>/dev/null || exit 0

_exports=$("$_AIWORKSPACE_NODE" "$_SCRIPT_DIR/mcp-load-env.mjs" --export-sh "$_ENV_FILE") || return 0 2>/dev/null || exit 0
[ -n "$_exports" ] || return 0 2>/dev/null || exit 0
eval "$_exports"

if [ -n "$_BEARER_KEYS" ]; then
  _keys=$(printf '%s\n' "$_BEARER_KEYS" | tr ',' '\n')
else
  _keys=$("$_AIWORKSPACE_NODE" "$_SCRIPT_DIR/mcp-bearer-env-keys.mjs") || return 0 2>/dev/null || exit 0
fi
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
  _current=$(launchctl getenv "$_key" 2>/dev/null) || _current=
  [ "$_val" = "$_current" ] && continue
  launchctl setenv "$_key" "$_val" 2>/dev/null || true
done

unset _SCRIPT_DIR _ENV_FILE _PATHS_FILE _line _AIWORKSPACE_NODE _BEARER_KEYS _exports _keys _key _val _current
