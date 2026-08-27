import { CONFIG } from './config.js';
import { runCheck } from './checker.js';
import { appendSample, appendOutage, loadState, saveState, cleanupOldFiles } from './store.js';
import { notify } from './notify.js';
import { fmtDuration } from './format.js';

let state = loadState();

function notifyIfEnabled(title, message) {
  if (CONFIG.notificationsEnabled) notify(title, message);
}

let running = false;

async function tick() {
  if (running) return; // avoid overlapping runs if a check ever takes longer than the interval
  running = true;
  try {
    let sample;
    try {
      sample = await runCheck(CONFIG);
    } catch (err) {
      console.error('[check failed]', err);
      return;
    }

    appendSample(sample);

    // If no checks ran for a while (machine asleep/off, process stopped),
    // that time is unmonitored: an outage that was ongoing when the gap
    // started ended — as far as we can attest — at the last sample we saw,
    // and the first checks after waking get a grace period so a network
    // stack that's still reconnecting isn't logged as a new outage.
    const prevT = state.lastSample?.t ?? null;
    if (prevT != null && sample.t - prevT > CONFIG.sleepGapMs) {
      if (state.ongoingOutageStart) {
        appendOutage({
          start: state.ongoingOutageStart,
          end: prevT,
          durationMs: prevT - state.ongoingOutageStart,
        });
        state.ongoingOutageStart = null;
        state.downNotified = false;
      }
      state.wakeGraceUntil = sample.t + CONFIG.wakeGraceMs;
    }

    const inWakeGrace = state.wakeGraceUntil != null && sample.t < state.wakeGraceUntil;

    if (sample.status === 'down') {
      if (inWakeGrace) {
        // still reconnecting after wake — don't start an outage yet
      } else {
        if (!state.ongoingOutageStart) {
          state.ongoingOutageStart = sample.t;
          state.downNotified = false;
        }
        if (!state.downNotified && sample.t - state.ongoingOutageStart >= CONFIG.notifyMinDurationMs) {
          notifyIfEnabled('Internet is down', 'The connection has been down for several seconds.');
          state.downNotified = true;
        }
      }
    } else if (state.ongoingOutageStart) {
      const durationMs = sample.t - state.ongoingOutageStart;
      appendOutage({
        start: state.ongoingOutageStart,
        end: sample.t,
        durationMs,
      });
      if (durationMs >= CONFIG.notifyMinDurationMs) {
        notifyIfEnabled('Internet is back', `The connection is back. It was down for ${fmtDuration(durationMs)}.`);
      }
      state.ongoingOutageStart = null;
      state.downNotified = false;
    }

    if (sample.status !== 'down') state.wakeGraceUntil = null;

    state.lastStatus = sample.status;
    state.lastSample = sample;
    saveState(state);
  } finally {
    running = false;
  }
}

export function startDaemon() {
  cleanupOldFiles();
  tick();
  setInterval(tick, CONFIG.intervalMs);
  setInterval(cleanupOldFiles, 24 * 60 * 60 * 1000);
}
