#!/bin/bash
set -euo pipefail

LABEL="com.internetmonitor.app"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
OLD_LABEL="com.andres.internetmonitor"
OLD_PLIST_PATH="$HOME/Library/LaunchAgents/${OLD_LABEL}.plist"

launchctl unload "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"
# Remove a previously-installed copy under the old label, if present.
launchctl unload "$OLD_PLIST_PATH" 2>/dev/null || true
rm -f "$OLD_PLIST_PATH"

echo "Servicio detenido y desinstalado."
