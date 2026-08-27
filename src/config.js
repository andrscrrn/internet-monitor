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
  notificationsEnabled: true,
  port: 5757,
  retentionDays: 30,
};
