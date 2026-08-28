import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateToMinutes,
  bucketSamples,
  summarize,
  computeNoDataMs,
} from '../src/aggregate.js';

const T0 = new Date(2026, 0, 15, 12, 0, 0).getTime(); // minute-aligned

function sample(t, status, avgMs, lossPct) {
  return { t, status, avgMs, lossPct };
}

// Two minutes of samples every 2s: first minute clean, second minute with a
// down stretch and a latency spike.
function twoMinutesOfSamples() {
  const out = [];
  for (let i = 0; i < 60; i++) {
    const t = T0 + i * 2000;
    if (i < 30) out.push(sample(t, 'up', 20, 0));
    else if (i < 40) out.push(sample(t, 'down', null, 100));
    else out.push(sample(t, 'degraded', 200, 0));
  }
  return out;
}

test('aggregateToMinutes keeps counts, sums and worst status per minute', () => {
  const agg = aggregateToMinutes(twoMinutesOfSamples());
  assert.equal(agg.length, 2);

  const [m1, m2] = agg;
  assert.equal(m1.t, T0);
  assert.equal(m1.n, 30);
  assert.equal(m1.down, 0);
  assert.equal(m1.status, 'up');
  assert.equal(m1.latSum, 30 * 20);
  assert.equal(m1.latN, 30);

  assert.equal(m2.n, 30);
  assert.equal(m2.down, 10);
  assert.equal(m2.status, 'down');
  assert.equal(m2.latN, 20); // down samples have no latency
  assert.equal(m2.lossSum, 10 * 100);
});

test('summarize gives identical results for raw samples and minute aggregates', () => {
  const raw = twoMinutesOfSamples();
  const agg = aggregateToMinutes(raw);
  const end = T0 + 120_000;

  const a = summarize(raw, [], T0, end);
  const b = summarize(agg, [], T0, end);
  assert.equal(a.totalSamples, b.totalSamples);
  assert.equal(a.uptimePct, b.uptimePct);
  assert.equal(a.avgLatency, b.avgLatency);
  assert.equal(a.avgLoss, b.avgLoss);
});

test('summarize on no samples returns nulls', () => {
  const s = summarize([], [], T0, T0 + 60_000);
  assert.equal(s.totalSamples, 0);
  assert.equal(s.uptimePct, null);
  assert.equal(s.avgLatency, null);
  assert.equal(s.avgLoss, null);
});

test('bucketSamples produces the same buckets from raw samples and aggregates', () => {
  const raw = twoMinutesOfSamples();
  const agg = aggregateToMinutes(raw);
  const end = T0 + 120_000 - 1;

  const fromRaw = bucketSamples(raw, 60_000, T0, end);
  const fromAgg = bucketSamples(agg, 60_000, T0, end);
  assert.deepEqual(fromRaw, fromAgg);
  assert.equal(fromRaw[0].status, 'up');
  assert.equal(fromRaw[1].status, 'down');
  assert.equal(fromRaw[0].samples, 30);
});

test('bucketSamples marks empty buckets as nodata', () => {
  const raw = [sample(T0, 'up', 20, 0)];
  const buckets = bucketSamples(raw, 60_000, T0, T0 + 179_000);
  assert.equal(buckets.length, 3);
  assert.equal(buckets[0].status, 'up');
  assert.equal(buckets[1].status, 'nodata');
  assert.equal(buckets[2].status, 'nodata');
});

test('computeNoDataMs counts large gaps between raw samples', () => {
  const raw = [
    sample(T0, 'up', 20, 0),
    sample(T0 + 2000, 'up', 20, 0),
    // 10-minute hole here
    sample(T0 + 602_000, 'up', 20, 0),
  ];
  const noData = computeNoDataMs(raw, T0, T0 + 604_000);
  assert.equal(noData, 600_000);
});

test('computeNoDataMs does not count contiguous minute aggregates as gaps', () => {
  const agg = aggregateToMinutes(twoMinutesOfSamples());
  const noData = computeNoDataMs(agg, T0, T0 + 120_000);
  assert.equal(noData, 0);
});

test('computeNoDataMs counts a missing minute between aggregates', () => {
  const agg = aggregateToMinutes(twoMinutesOfSamples());
  const later = { ...agg[1], t: agg[1].t + 180_000 }; // 3-minute hole after minute 1
  const noData = computeNoDataMs([agg[0], later], T0, later.t + 60_000);
  assert.equal(noData, 180_000);
});
