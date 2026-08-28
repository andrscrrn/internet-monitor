#!/bin/bash
# Started by launchd on login (and on every restart): update to the latest
# pushed version, then run the monitor.
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# launchd starts with a minimal PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE_BIN="${NODE_BIN:-$(command -v node)}"

# Right after boot/login, Wi-Fi and DNS often aren't up yet, so an immediate
# git pull would just fail. Give the network up to WAIT_TIMEOUT seconds to
# come up (checking every 2s) before attempting the pull at all — but never
# hold up the monitor itself: if it's still not up by then, move on and start
# with whatever's already on disk.
WAIT_TIMEOUT=60
waited=0
while ! ping -c 1 -t 2 github.com >/dev/null 2>&1; do
  if [ "$waited" -ge "$WAIT_TIMEOUT" ]; then
    echo "[start] no network after ${WAIT_TIMEOUT}s; starting the current version" >&2
    break
  fi
  sleep 2
  waited=$((waited + 2))
done

# Best effort beyond this point too: SSH may not be able to authenticate
# non-interactively, or local edits may block the merge. None of that should
# ever stop the monitor from starting with the current version.
if GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10" git pull --ff-only; then
  NPM_BIN="$(dirname "$NODE_BIN")/npm"
  HASH_FILE="node_modules/.package-lock.hash"
  LOCK_HASH="$(shasum package-lock.json | cut -d' ' -f1)"
  if [ ! -d node_modules ] || [ "$(cat "$HASH_FILE" 2>/dev/null)" != "$LOCK_HASH" ]; then
    # Invoke npm's script via $NODE_BIN directly rather than executing it: npm's
    # bin file has a "#!/usr/bin/env node" shebang, and launchd's minimal PATH
    # (even with the prepend above) often doesn't contain a version-managed
    # node install (nvm, etc.), so plain `env node` resolution fails there.
    "$NODE_BIN" "$NPM_BIN" install --no-audit --no-fund && echo "$LOCK_HASH" > "$HASH_FILE"
  fi
else
  echo "[start] git pull failed; starting the current version" >&2
fi

exec "$NODE_BIN" src/main.js
