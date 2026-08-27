import { CONFIG } from './config.js';

const RANGE_MS = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const BUCKET_MS = {
  '15m': 2_000,
  '30m': 2_000,
  '1h': 2_000,
  '6h': 10_000,
  '24h': 60_000,
  '7d': 10 * 60_000,
};

export function rangeMs(range) {
  return RANGE_MS[range] || RANGE_MS['24h'];
}

export function bucketMs(range) {
  return BUCKET_MS[range] || BUCKET_MS['24h'];
}

// For an arbitrary (non-preset) zoomed window: aim for ~500 buckets across the
// span, but never coarser than the raw check interval.
export function bucketMsForWindow(durationMs) {
  return Math.max(CONFIG.intervalMs, Math.round(durationMs / 500));
}

const STATUS_RANK = { up: 0, degraded: 1, down: 2 };

export function bucketSamples(samples, bucketSizeMs, rangeStart, rangeEnd) {
  const groups = new Map();
  for (const s of samples) {
    const bucketStart = Math.floor(s.t / bucketSizeMs) * bucketSizeMs;
    if (!groups.has(bucketStart)) groups.set(bucketStart, []);
    groups.get(bucketStart).push(s);
  }

  const firstBucket = Math.floor(rangeStart / bucketSizeMs) * bucketSizeMs;
  const lastBucket = Math.floor(rangeEnd / bucketSizeMs) * bucketSizeMs;

  const out = [];
  for (let t = firstBucket; t <= lastBucket; t += bucketSizeMs) {
    const group = groups.get(t);
    if (!group || !group.length) {
      out.push({ t, avgMs: null, lossPct: null, status: 'nodata', samples: 0 });
      continue;
    }
    const latencies = group.map((s) => s.avgMs).filter((v) => v != null);
    const avgMs = latencies.length
      ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10
      : null;
    const avgLoss = Math.round(
      group.reduce((a, s) => a + s.lossPct, 0) / group.length
    );
    let worst = 'up';
    for (const s of group) {
      if (STATUS_RANK[s.status] > STATUS_RANK[worst]) worst = s.status;
    }
    out.push({ t, avgMs, lossPct: avgLoss, status: worst, samples: group.length });
  }
  return out;
}

// Time within [rangeStart, rangeEnd] where no checks ran at all (e.g. the
// machine was asleep) — a gap much larger than the normal check interval.
export function computeNoDataMs(samples, rangeStart, rangeEnd) {
  const gapThreshold = CONFIG.intervalMs * 2;
  let noData = 0;
  let prev = rangeStart;
  for (const s of samples) {
    if (s.t - prev > gapThreshold) noData += s.t - prev;
    prev = s.t;
  }
  if (rangeEnd - prev > gapThreshold) noData += rangeEnd - prev;
  return noData;
}

export function summarize(samples, outages, rangeStart, rangeEnd) {
  const total = samples.length;
  const downSamples = samples.filter((s) => s.status === 'down').length;
  const upOrDegraded = total - downSamples;
  const uptimePct = total ? Math.round((upOrDegraded / total) * 1000) / 10 : null;

  const latencies = samples.map((s) => s.avgMs).filter((v) => v != null);
  const avgLatency = latencies.length
    ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10
    : null;

  const avgLoss = total
    ? Math.round(samples.reduce((a, s) => a + s.lossPct, 0) / total)
    : null;

  const totalDowntimeMs = outages.reduce((a, o) => a + o.durationMs, 0);
  const noDataMs =
    rangeStart != null && rangeEnd != null ? computeNoDataMs(samples, rangeStart, rangeEnd) : null;

  // Average time between outages, based on time actually monitored (excludes
  // "sin monitorear" gaps so those don't make outages look rarer than they are).
  let avgOutageIntervalMs = null;
  if (outages.length > 0 && rangeStart != null && rangeEnd != null) {
    const monitoredMs = rangeEnd - rangeStart - noDataMs;
    avgOutageIntervalMs = monitoredMs / outages.length;
  }

  return {
    totalSamples: total,
    uptimePct,
    avgLatency,
    avgLoss,
    outageCount: outages.length,
    totalDowntimeMs,
    noDataMs,
    avgOutageIntervalMs,
  };
}

function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function dayBoundsMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  const start = new Date(y, m - 1, d).getTime();
  const end = new Date(y, m - 1, d + 1).getTime();
  return [start, end];
}

export function dailyBreakdown(samples, outages, rangeStart, rangeEnd) {
  const days = new Map();
  for (const s of samples) {
    const key = dayKey(s.t);
    if (!days.has(key)) days.set(key, { key, samples: [], outages: [] });
    days.get(key).samples.push(s);
  }
  for (const o of outages) {
    const key = dayKey(o.start);
    if (!days.has(key)) days.set(key, { key, samples: [], outages: [] });
    days.get(key).outages.push(o);
  }
  return [...days.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((d) => {
      const [dayStart, dayEnd] = dayBoundsMs(d.key);
      const start = Math.max(rangeStart, dayStart);
      const end = Math.min(rangeEnd, dayEnd);
      return { key: d.key, ...summarize(d.samples, d.outages, start, end) };
    });
}
