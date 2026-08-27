import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.join(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');
export const OUTAGES_FILE = path.join(DATA_DIR, 'outages.jsonl');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const DEFAULTS = {
  targets: ['1.1.1.1', '8.8.8.8', '9.9.9.9'],
  dnsCheckHost: 'google.com',
  intervalMs: 2_000,
  pingTimeoutSec: 1,
  degradedLatencyMs: 150,
  notifyMinDurationMs: 5_000,
  // A gap between samples larger than this means no checks ran (machine
  // asleep/off or the process was stopped) — that time is "not monitored",
  // never outage time.
  sleepGapMs: 30_000,
  // Right after waking, the network stack takes a few seconds to reconnect;
  // don't log those first failed checks as an outage.
  wakeGraceMs: 15_000,
  notificationsEnabled: true,
  port: 5757,
  // Only reachable from this machine by default; set to "0.0.0.0" in
  // config.json to expose the dashboard to your LAN (e.g. to open it from
  // your phone).
  host: '127.0.0.1',
  retentionDays: 30,
};

// Optional overrides from config.json at the project root, so tweaking the
// port, targets or thresholds doesn't require editing source. Unknown keys
// are rejected loudly to catch typos.
function loadOverrides() {
  const file = path.join(ROOT_DIR, 'config.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const overrides = JSON.parse(raw); // a malformed config.json should fail loudly, not be ignored
  for (const key of Object.keys(overrides)) {
    if (!(key in DEFAULTS)) {
      throw new Error(`config.json: unknown option "${key}" (valid: ${Object.keys(DEFAULTS).join(', ')})`);
    }
  }
  return overrides;
}

export const CONFIG = { ...DEFAULTS, ...loadOverrides() };
