import { execFile } from 'node:child_process';
import fs from 'node:fs';

// launchd's minimal PATH may not include Homebrew's bin dir, so use the full path.
const TERMINAL_NOTIFIER = '/opt/homebrew/bin/terminal-notifier';
const HAS_TERMINAL_NOTIFIER = fs.existsSync(TERMINAL_NOTIFIER);
const IS_MAC = process.platform === 'darwin';

function escapeAppleScript(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function notify(title, message, { sound = 'Basso' } = {}) {
  if (!IS_MAC) {
    // No native notification on this OS — the dashboard's own on-screen
    // alert (flash + siren) already covers this while it's open.
    console.log(`[notify] ${title}: ${message}`);
    return;
  }
  if (HAS_TERMINAL_NOTIFIER) {
    const args = ['-title', title, '-message', message];
    if (sound) args.push('-sound', sound);
    execFile(TERMINAL_NOTIFIER, args, (err) => {
      if (err) console.error('[notify failed]', err.message);
    });
    return;
  }
  // Fallback that ships with macOS — no extra install needed.
  const script =
    `display notification "${escapeAppleScript(message)}" ` +
    `with title "${escapeAppleScript(title)}"` +
    (sound ? ` sound name "${escapeAppleScript(sound)}"` : '');
  execFile('/usr/bin/osascript', ['-e', script], (err) => {
    if (err) console.error('[notify failed]', err.message);
  });
}
