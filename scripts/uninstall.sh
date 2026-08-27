#!/bin/bash
set -euo pipefail

LABEL="com.internetmonitor.app"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl unload "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"

echo "Service stopped and uninstalled."
