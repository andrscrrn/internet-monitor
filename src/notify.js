import { execFile } from 'node:child_process';

// launchd's minimal PATH may not include Homebrew's bin dir, so use the full path.
const TERMINAL_NOTIFIER = '/opt/homebrew/bin/terminal-notifier';

export function notify(title, message, { sound = 'Basso' } = {}) {
  const args = ['-title', title, '-message', message];
  if (sound) args.push('-sound', sound);
  execFile(TERMINAL_NOTIFIER, args, (err) => {
    if (err) console.error('[notify failed]', err.message);
  });
}
