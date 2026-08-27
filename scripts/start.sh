#!/bin/bash
# Started by launchd on login (and on every restart): update to the latest
# pushed version, then run the monitor.
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# launchd starts with a minimal PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE_BIN="${NODE_BIN:-$(command -v node)}"

# Best effort: at login the network may not be up yet, SSH may not be able to
# authenticate non-interactively, or local edits may block the merge. None of
# that should ever stop the monitor from starting with the current version.
if GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10" git pull --ff-only; then
  NPM_BIN="$(dirname "$NODE_BIN")/npm"
  HASH_FILE="node_modules/.package-lock.hash"
  LOCK_HASH="$(shasum package-lock.json | cut -d' ' -f1)"
  if [ ! -d node_modules ] || [ "$(cat "$HASH_FILE" 2>/dev/null)" != "$LOCK_HASH" ]; then
    "$NPM_BIN" install --no-audit --no-fund && echo "$LOCK_HASH" > "$HASH_FILE"
  fi
else
  echo "[start] git pull failed; starting the current version" >&2
fi

exec "$NODE_BIN" src/main.js
