import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/checker.js';

const DEGRADED_MS = 150;

function ping(ms) {
  return { host: 'x', alive: ms != null, ms };
}

test('all targets alive with low latency is up', () => {
  const r = classify([ping(10), ping(20), ping(30)], DEGRADED_MS);
  assert.equal(r.status, 'up');
  assert.equal(r.lossPct, 0);
  assert.equal(r.avgMs, 20);
});

test('all targets dead is down', () => {
  const r = classify([ping(null), ping(null), ping(null)], DEGRADED_MS);
  assert.equal(r.status, 'down');
  assert.equal(r.lossPct, 100);
  assert.equal(r.avgMs, null);
});

test('partial loss is degraded', () => {
  const r = classify([ping(10), ping(null), ping(10)], DEGRADED_MS);
  assert.equal(r.status, 'degraded');
  assert.equal(r.lossPct, 33);
});

test('high average latency is degraded even with no loss', () => {
  const r = classify([ping(200), ping(300), ping(250)], DEGRADED_MS);
  assert.equal(r.status, 'degraded');
  assert.equal(r.lossPct, 0);
});

test('latency exactly at the threshold is still up', () => {
  const r = classify([ping(DEGRADED_MS), ping(DEGRADED_MS)], DEGRADED_MS);
  assert.equal(r.status, 'up');
});
