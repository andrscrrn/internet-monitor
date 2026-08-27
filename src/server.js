import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, PUBLIC_DIR } from './config.js';
import { readSamplesInRange, readSeriesInRange, readOutagesInRange, readLastOutage, loadState } from './store.js';
import { rangeMs, bucketMs, bucketMsForWindow, bucketSamples, summarize } from './aggregate.js';

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

function sendJson(res, data) {
  const body = JSON.stringify(data);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// Resolves the requested window either from a preset `range` key or from
// explicit `start`/`end` query params (used for custom zoom selections).
function resolveWindow(url, now) {
  const startParam = Number(url.searchParams.get('start'));
  const endParam = Number(url.searchParams.get('end'));
  if (Number.isFinite(startParam) && Number.isFinite(endParam) && endParam > startParam) {
    return { start: startParam, end: Math.min(endParam, now), bucketSizeMs: bucketMsForWindow(endParam - startParam) };
  }
  const range = url.searchParams.get('range') || '24h';
  return { start: now - rangeMs(range), end: now, bucketSizeMs: bucketMs(range) };
}

function outagesWithOngoing(start, end, now) {
  const outages = readOutagesInRange(start, end);
  const state = loadState();
  if (state.ongoingOutageStart && state.ongoingOutageStart <= end) {
    outages.push({
      start: state.ongoingOutageStart,
      end: now,
      durationMs: now - state.ongoingOutageStart,
      ongoing: true,
    });
  }
  return outages.sort((a, b) => a.start - b.start);
}

export function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const now = Date.now();

    if (url.pathname === '/api/status') {
      const state = loadState();
      sendJson(res, {
        lastSample: state.lastSample || null,
        ongoingOutageStart: state.ongoingOutageStart || null,
        lastOutageEnd: readLastOutage()?.end || null,
        now,
      });
      return;
    }

    if (url.pathname === '/api/history') {
      const { start, end, bucketSizeMs } = resolveWindow(url, now);
      const samples = readSeriesInRange(start, end);
      // Past days are served as per-minute aggregates, so a finer bucket
      // than 1 minute would just leave empty buckets between points.
      const todayStart = new Date(now).setHours(0, 0, 0, 0);
      const effBucketMs = start < todayStart ? Math.max(bucketSizeMs, 60_000) : bucketSizeMs;
      const bucketed = bucketSamples(samples, effBucketMs, start, end);
      sendJson(res, { start, end, points: bucketed });
      return;
    }

    if (url.pathname === '/api/outages') {
      const { start, end } = resolveWindow(url, now);
      sendJson(res, { start, end, outages: outagesWithOngoing(start, end, now) });
      return;
    }

    if (url.pathname === '/api/outage-detail') {
      const start = Number(url.searchParams.get('start'));
      const end = Number(url.searchParams.get('end'));
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        res.writeHead(400);
        res.end('Missing or invalid start/end');
        return;
      }
      const padding = 5000;
      const samples = readSamplesInRange(start - padding, Math.min(end + padding, now));
      sendJson(res, { samples });
      return;
    }

    if (url.pathname === '/api/summary') {
      const { start, end } = resolveWindow(url, now);
      const samples = readSeriesInRange(start, end);
      const outages = outagesWithOngoing(start, end, now);
      sendJson(res, { start, end, ...summarize(samples, outages, start, end) });
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(CONFIG.port, () => {
    console.log(`Dashboard: http://localhost:${CONFIG.port}`);
  });

  return server;
}
