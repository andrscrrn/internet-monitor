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

// A "point" here is either a raw sample ({t, status, avgMs, lossPct}) or a
// pre-aggregated minute bucket ({t, spanMs, n, down, latSum, latN, lossSum,
// status}) produced by aggregateToMinutes. This normalizes both shapes into
// the same weighted accumulator form so every function below can mix them.
function weighted(s) {
  const n = s.n ?? 1;
  return {
    n,
    down: s.down ?? (s.status === 'down' ? 1 : 0),
    latSum: s.latSum ?? (s.avgMs ?? 0),
    latN: s.latN ?? (s.avgMs != null ? 1 : 0),
    lossSum: s.lossSum ?? (s.lossPct ?? 0),
  };
}

// Collapse raw samples into per-minute buckets that keep enough sums to
// reproduce exact summaries later (uptime, latency, loss) without the raw
// data. Used to persist closed days in compact form.
export function aggregateToMinutes(samples) {
  const buckets = new Map();
  for (const s of samples) {
    const t = Math.floor(s.t / 60_000) * 60_000;
    let b = buckets.get(t);
    if (!b) {
      b = { t, spanMs: 60_000, n: 0, down: 0, latSum: 0, latN: 0, lossSum: 0, status: 'up' };
      buckets.set(t, b);
    }
    b.n++;
    if (s.status === 'down') b.down++;
    if (s.avgMs != null) {
      b.latSum += s.avgMs;
      b.latN++;
    }
    b.lossSum += s.lossPct ?? 0;
    if (STATUS_RANK[s.status] > STATUS_RANK[b.status]) b.status = s.status;
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

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
    let n = 0, latSum = 0, latN = 0, lossSum = 0;
    let worst = 'up';
    for (const s of group) {
      const w = weighted(s);
      n += w.n;
      latSum += w.latSum;
      latN += w.latN;
      lossSum += w.lossSum;
      if (STATUS_RANK[s.status] > STATUS_RANK[worst]) worst = s.status;
    }
    const avgMs = latN ? Math.round((latSum / latN) * 10) / 10 : null;
    const avgLoss = Math.round(lossSum / n);
    out.push({ t, avgMs, lossPct: avgLoss, status: worst, samples: n });
  }
  return out;
}

// Time within [rangeStart, rangeEnd] where no checks ran at all (e.g. the
// machine was asleep) — a gap much larger than the normal check interval.
// Minute-aggregate points cover a span, so the gap is measured from the end
// of the previous point's span, not its start.
export function computeNoDataMs(samples, rangeStart, rangeEnd) {
  const gapThreshold = CONFIG.intervalMs * 2;
  let noData = 0;
  let prevEnd = rangeStart;
  for (const s of samples) {
    if (s.t - prevEnd > gapThreshold) noData += s.t - prevEnd;
    prevEnd = Math.max(prevEnd, s.t + (s.spanMs ?? 0));
  }
  if (rangeEnd - prevEnd > gapThreshold) noData += rangeEnd - prevEnd;
  return noData;
}

export function summarize(samples, outages, rangeStart, rangeEnd) {
  let total = 0, down = 0, latSum = 0, latN = 0, lossSum = 0;
  for (const s of samples) {
    const w = weighted(s);
    total += w.n;
    down += w.down;
    latSum += w.latSum;
    latN += w.latN;
    lossSum += w.lossSum;
  }
  const uptimePct = total ? Math.round(((total - down) / total) * 1000) / 10 : null;
  const avgLatency = latN ? Math.round((latSum / latN) * 10) / 10 : null;
  const avgLoss = total ? Math.round(lossSum / total) : null;

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
