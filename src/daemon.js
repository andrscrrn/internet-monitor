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

    if (sample.status === 'down') {
      if (!state.ongoingOutageStart) {
        state.ongoingOutageStart = sample.t;
        state.downNotified = false;
      }
      if (!state.downNotified && sample.t - state.ongoingOutageStart >= CONFIG.notifyMinDurationMs) {
        notifyIfEnabled('Internet caido', 'La conexion lleva varios segundos caida.');
        state.downNotified = true;
      }
    } else if (state.ongoingOutageStart) {
      const durationMs = sample.t - state.ongoingOutageStart;
      appendOutage({
        start: state.ongoingOutageStart,
        end: sample.t,
        durationMs,
      });
      if (durationMs >= CONFIG.notifyMinDurationMs) {
        notifyIfEnabled('Internet recuperado', `La conexion volvio. Estuvo caida ${fmtDuration(durationMs)}.`);
      }
      state.ongoingOutageStart = null;
      state.downNotified = false;
    }

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
