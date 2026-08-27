import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, STATE_FILE, OUTAGES_FILE, CONFIG } from './config.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayFilePath(date) {
  return path.join(DATA_DIR, `data-${dateKey(date)}.jsonl`);
}

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function appendSample(sample) {
  ensureDataDir();
  const file = dayFilePath(new Date(sample.t));
  fs.appendFileSync(file, JSON.stringify(sample) + '\n');
}

export function appendOutage(outage) {
  ensureDataDir();
  fs.appendFileSync(OUTAGES_FILE, JSON.stringify(outage) + '\n');
}

export function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { ongoingOutageStart: null, lastStatus: null };
  }
}

export function saveState(state) {
  ensureDataDir();
  // Write-then-rename so a crash mid-write can't leave a corrupt state.json
  // (which would silently reset ongoing-outage tracking on restart).
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

function readJsonl(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function readSamplesInRange(startMs, endMs) {
  const out = [];
  const cursor = new Date(startMs);
  const end = new Date(endMs);
  while (cursor <= end) {
    const rows = readJsonl(dayFilePath(cursor));
    for (const row of rows) {
      if (row.t >= startMs && row.t <= endMs) out.push(row);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out.sort((a, b) => a.t - b.t);
}

export function readOutagesInRange(startMs, endMs) {
  return readJsonl(OUTAGES_FILE)
    .filter((o) => o.end >= startMs && o.start <= endMs)
    .sort((a, b) => a.start - b.start);
}

export function readLastOutage() {
  const outages = readJsonl(OUTAGES_FILE);
  if (!outages.length) return null;
  return outages.reduce((latest, o) => (o.end > latest.end ? o : latest));
}

export function cleanupOldFiles() {
  ensureDataDir();
  const cutoff = Date.now() - CONFIG.retentionDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(DATA_DIR)) {
    const match = /^data-(\d{4})-(\d{2})-(\d{2})\.jsonl$/.exec(name);
    if (!match) continue;
    const fileDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (fileDate.getTime() < cutoff) {
      fs.unlinkSync(path.join(DATA_DIR, name));
    }
  }
}
