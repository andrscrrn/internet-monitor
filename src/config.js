import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.join(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');
export const OUTAGES_FILE = path.join(DATA_DIR, 'outages.jsonl');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export const CONFIG = {
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
  retentionDays: 30,
};
