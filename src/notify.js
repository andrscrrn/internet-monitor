import { execFile } from 'node:child_process';

// launchd's minimal PATH may not include Homebrew's bin dir, so use the full path.
const TERMINAL_NOTIFIER = '/opt/homebrew/bin/terminal-notifier';
const IS_MAC = process.platform === 'darwin';

export function notify(title, message, { sound = 'Basso' } = {}) {
  if (!IS_MAC) {
    // No native notification on this OS — the dashboard's own on-screen
    // alert (flash + siren) already covers this while it's open.
    console.log(`[notify] ${title}: ${message}`);
    return;
  }
  const args = ['-title', title, '-message', message];
  if (sound) args.push('-sound', sound);
  execFile(TERMINAL_NOTIFIER, args, (err) => {
    if (err) console.error('[notify failed]', err.message);
  });
}
