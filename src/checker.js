import { execFile } from 'node:child_process';
import dns from 'node:dns';

function pingOnce(host, timeoutSec) {
  return new Promise((resolve) => {
    execFile(
      'ping',
      // -c 1: one echo request. -t: overall timeout in seconds (macOS/BSD ping).
      ['-c', '1', '-t', String(timeoutSec), host],
      { timeout: (timeoutSec + 2) * 1000 },
      (err, stdout) => {
        const match = /time=([\d.]+)\s*ms/i.exec(stdout || '');
        if (match) {
          resolve({ host, alive: true, ms: parseFloat(match[1]) });
        } else {
          resolve({ host, alive: false, ms: null });
        }
      }
    );
  });
}

function dnsCheck(hostname, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(false);
      }
    }, timeoutMs);
    dns.resolve4(hostname, (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(!err);
    });
  });
}

export async function pingAll(targets, timeoutSec) {
  return Promise.all(targets.map((t) => pingOnce(t, timeoutSec)));
}

export function classify(results, degradedLatencyMs) {
  const total = results.length;
  const aliveResults = results.filter((r) => r.alive);
  const aliveCount = aliveResults.length;
  const lossPct = Math.round(((total - aliveCount) / total) * 100);
  const avgMs =
    aliveCount > 0
      ? Math.round(
          (aliveResults.reduce((sum, r) => sum + r.ms, 0) / aliveCount) * 10
        ) / 10
      : null;

  let status;
  if (aliveCount === 0) {
    status = 'down';
  } else if (aliveCount < total || avgMs > degradedLatencyMs) {
    status = 'degraded';
  } else {
    status = 'up';
  }

  return { status, lossPct, avgMs };
}

// A single dropped ICMP packet in one isolated tick is normal network noise,
// not degradation. Partial loss only counts as degraded when it persists
// across consecutive ticks; the loss is still recorded either way.
let prevPartialLoss = false;

export async function runCheck(config) {
  const [results, dnsOk] = await Promise.all([
    pingAll(config.targets, config.pingTimeoutSec),
    dnsCheck(config.dnsCheckHost, 1200),
  ]);
  const { status, lossPct, avgMs } = classify(results, config.degradedLatencyMs);

  const partialLoss = lossPct > 0 && lossPct < 100;
  const partialLossOnly =
    status === 'degraded' && partialLoss && (avgMs == null || avgMs <= config.degradedLatencyMs);
  let effectiveStatus = partialLossOnly && !prevPartialLoss ? 'up' : status;
  prevPartialLoss = partialLoss;

  // Pings reaching raw IPs while DNS fails means the connection is unusable
  // for normal browsing: that's degraded, not "up".
  if (effectiveStatus === 'up' && !dnsOk) effectiveStatus = 'degraded';
  return {
    t: Date.now(),
    status: effectiveStatus,
    lossPct,
    avgMs,
    dnsOk,
    results,
  };
}
