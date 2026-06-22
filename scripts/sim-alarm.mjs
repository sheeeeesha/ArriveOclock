// Standalone simulation of the POSITION-BASED fire decision in src/alarm.js.
// Replicates begin()+processFix() math to verify firing across scenarios.
const START_GRACE_MS = 15000, ARRIVAL_RADIUS_M = 150, MOVING_MPS = 0.6;

function run(name, { totalMin, userLead, fixes }) {
  // begin()
  const leadMin = Math.min(userLead, Math.max(0.5, totalMin * 0.6));
  let speedMps = (totalMin > 0) ? (/*planned*/ (fixes[0]?.remainingM ?? 1000) / (totalMin * 60)) : 0;
  let measuredEtaMin = totalMin;
  let hasDeparted = false, fired = false, fireT = null;
  const tripStartMs = 0;

  for (const f of fixes) {
    if (fired) break;
    // rolling speed (we feed instantaneous speed directly)
    speedMps = Math.max(0, 0.5 * speedMps + 0.5 * f.inst);
    if (speedMps > 0.4) measuredEtaMin = f.remainingM / speedMps / 60;
    if (f.directM > ARRIVAL_RADIUS_M) hasDeparted = true;
    const approaching = speedMps > MOVING_MPS && measuredEtaMin != null && measuredEtaMin <= leadMin;
    const arrived = hasDeparted && f.directM <= ARRIVAL_RADIUS_M;
    if ((approaching || arrived) && (f.t - tripStartMs >= START_GRACE_MS)) { fired = true; fireT = f.t; }
  }
  console.log(`${name.padEnd(42)} leadMin=${leadMin.toFixed(1)}  -> ${fired ? 'FIRED @ ' + (fireT/1000) + 's' : 'no fire'}`);
  return { fired, fireT };
}

// helper: build a sequence of fixes every `stepS` seconds.
const seq = (n, stepS, fn) => Array.from({ length: n }, (_, i) => ({ t: i * stepS * 1000, ...fn(i) }));

console.log('--- expected: NO fire ---');
// 1) Stationary, far away (5km), never moves — the reported bug #2.
run('stationary far (5km, 0 m/s, 5min)', { totalMin: 20, userLead: 5,
  fixes: seq(60, 30, () => ({ remainingM: 5000, directM: 5000, inst: 0 })) });
// 2) Start far, never moves, long wait.
run('stationary far, 30min wait', { totalMin: 20, userLead: 5,
  fixes: seq(60, 60, () => ({ remainingM: 8000, directM: 8000, inst: 0 })) });
// 3) Start already AT dest but never moves (degenerate) — should not nag.
run('parked at dest, never moves', { totalMin: 2, userLead: 5,
  fixes: seq(40, 30, () => ({ remainingM: 40, directM: 40, inst: 0 })) });

console.log('--- expected: FIRE near arrival, NOT at start ---');
// 4) Normal trip: 8km, moving ~8 m/s, approaches over ~17 min.
run('normal 8km trip, ~8 m/s', { totalMin: 17, userLead: 5,
  fixes: seq(140, 8, (i) => { const rem = Math.max(0, 8000 - i * 64); return { remainingM: rem, directM: rem, inst: 8 }; }) });
// 5) Short trip: 1.5km, moving ~6 m/s (~4 min) — must NOT ring at start.
run('short 1.5km trip, ~6 m/s', { totalMin: 4, userLead: 5,
  fixes: seq(120, 5, (i) => { const rem = Math.max(0, 1500 - i * 30); return { remainingM: rem, directM: rem, inst: 6 }; }) });
// 6) Moves, then STOPS 1km short for a long time, then resumes to arrival.
run('moves, stalls 1km out 10min, resumes', { totalMin: 15, userLead: 5,
  fixes: [
    ...seq(20, 10, (i) => { const rem = Math.max(1000, 6000 - i * 250); return { remainingM: rem, directM: rem, inst: 7 }; }),
    ...seq(60, 10, () => ({ remainingM: 1000, directM: 1000, inst: 0 })),         // stalled 10 min at 1km
    ...seq(40, 8, (i) => { const rem = Math.max(0, 1000 - i * 30); return { t: 0, remainingM: rem, directM: rem, inst: 6 }; }).map((f, i) => ({ ...f, t: (200 + 600 + i * 8) * 1000 })),
  ] });
