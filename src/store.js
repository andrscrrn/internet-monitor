import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, STATE_FILE, OUTAGES_FILE, CONFIG } from './config.js';
import { aggregateToMinutes } from './aggregate.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayFilePath(date) {
  return path.join(DATA_DIR, `data-${dateKey(date)}.jsonl`);
}

function aggFilePath(key) {
  return path.join(DATA_DIR, `agg-${key}.json`);
}

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory copy of today's samples, so the dashboard's constant polling
// never re-reads/re-parses today's (large) day file from disk. Warmed from
// disk on first use; appendSample keeps it in sync from then on.
let todayKey = null;
let todaySamples = null;

function warmToday(key) {
  if (todaySamples && todayKey === key) return;
  todayKey = key;
  todaySamples = readJsonl(path.join(DATA_DIR, `data-${key}.jsonl`));
}

export function appendSample(sample) {
  ensureDataDir();
  const key = dateKey(new Date(sample.t));
  warmToday(key); // must read the file *before* this sample lands on disk
  fs.appendFileSync(path.join(DATA_DIR, `data-${key}.jsonl`), JSON.stringify(sample) + '\n');
  todaySamples.push(sample);
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
  const nowKey = dateKey(new Date());
  const out = [];
  const cursor = new Date(startMs);
  const end = new Date(endMs);
  while (cursor <= end) {
    const key = dateKey(cursor);
    let rows;
    if (key === nowKey) {
      warmToday(key);
      rows = todaySamples;
    } else {
      rows = readJsonl(dayFilePath(cursor));
    }
    for (const row of rows) {
      if (row.t >= startMs && row.t <= endMs) out.push(row);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out.sort((a, b) => a.t - b.t);
}

// Per-minute aggregates for a *closed* day (any day before today). Built
// lazily from the raw day file, persisted as agg-<key>.json so it's only
// computed once, and memoized in memory (~1440 tiny entries per day).
const minuteAggCache = new Map();

function minuteAggForDay(key) {
  if (minuteAggCache.has(key)) return minuteAggCache.get(key);
  let agg = null;
  try {
    agg = JSON.parse(fs.readFileSync(aggFilePath(key), 'utf8'));
  } catch {
    agg = aggregateToMinutes(readJsonl(path.join(DATA_DIR, `data-${key}.jsonl`)));
    try {
      ensureDataDir();
      const tmp = aggFilePath(key) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(agg));
      fs.renameSync(tmp, aggFilePath(key));
    } catch (err) {
      console.error('[agg cache write failed]', err.message);
    }
  }
  minuteAggCache.set(key, agg);
  return agg;
}

// Like readSamplesInRange, but past days come back as per-minute aggregate
// points instead of raw samples (aggregate.js handles both shapes). Today is
// served raw from memory. This is what the dashboard's summary/history
// endpoints use: it makes wide ranges (7d) cheap without touching the raw
// files on every poll.
export function readSeriesInRange(startMs, endMs) {
  const nowKey = dateKey(new Date());
  const out = [];
  const cursor = new Date(startMs);
  const end = new Date(endMs);
  while (cursor <= end) {
    const key = dateKey(cursor);
    if (key === nowKey) {
      warmToday(key);
      for (const s of todaySamples) {
        if (s.t >= startMs && s.t <= endMs) out.push(s);
      }
    } else {
      for (const b of minuteAggForDay(key)) {
        if (b.t + b.spanMs > startMs && b.t <= endMs) out.push(b);
      }
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
    const match = /^(?:data|agg)-(\d{4})-(\d{2})-(\d{2})\.jsonl?$/.exec(name);
    if (!match) continue;
    const fileDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (fileDate.getTime() < cutoff) {
      fs.unlinkSync(path.join(DATA_DIR, name));
    }
  }
}
