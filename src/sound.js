// ---------------------------------------------------------------------------
// Built-in alarm tones, synthesised with the Web Audio API. No audio files to
// ship; each tone is a short motif. playTone() loops it (the alarm);
// previewTone() plays one cycle (tapping a tone in Settings).
// ---------------------------------------------------------------------------

let ctx = null;
let loopTimer = null;

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// name -> { notes:[Hz | 0 for rest], step:s, wave, gain, decay }
const TONE_DEFS = {
  'Lo-fi':       { notes: [392, 440, 523.25, 440],            step: 0.34, wave: 'sine',     gain: 0.18, decay: 1.6 },
  Sunrise:       { notes: [523.25, 587.33, 659.25, 783.99],   step: 0.28, wave: 'sine',     gain: 0.16, decay: 1.5 },
  Marimba:       { notes: [523.25, 659.25, 783.99, 1046.5],   step: 0.16, wave: 'triangle', gain: 0.26, decay: 0.7 },
  'Soft Chime':  { notes: [659.25, 987.77, 1318.5],           step: 0.42, wave: 'triangle', gain: 0.2,  decay: 2.0 },
  Beacon:        { notes: [660, 880, 660, 880],               step: 0.24, wave: 'triangle', gain: 0.18, decay: 0.9 },
  Digital:       { notes: [1000, 0, 1000, 0],                 step: 0.13, wave: 'square',   gain: 0.1,  decay: 0.5 },
  Radar:         { notes: [1245, 0, 0, 0],                    step: 0.2,  wave: 'sine',     gain: 0.16, decay: 1.4 },
  Uplift:        { notes: [392, 523.25, 659.25, 783.99, 1046.5], step: 0.12, wave: 'sine',  gain: 0.16, decay: 0.9 },
  Pulse:         { notes: [330, 330],                         step: 0.2,  wave: 'square',   gain: 0.12, decay: 0.6 },
  'Classic Bell':{ notes: [880, 880, 0, 880],                 step: 0.18, wave: 'triangle', gain: 0.22, decay: 0.9 },
};

export function toneNames() {
  return Object.keys(TONE_DEFS);
}

function blip(freq, when, dur, wave, gain) {
  if (!freq) return;
  const a = audio();
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g).connect(a.destination);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

function playCycle(def) {
  const a = audio();
  const t0 = a.currentTime + 0.02;
  def.notes.forEach((n, i) => blip(n, t0 + i * def.step, def.step * def.decay, def.wave, def.gain));
}

export function playTone(name) {
  stopTone();
  const def = TONE_DEFS[name] || TONE_DEFS['Lo-fi'];
  playCycle(def);
  loopTimer = setInterval(() => playCycle(def), def.notes.length * def.step * 1000 + 250);
}

// One-shot, for previewing a tone in Settings without arming a loop.
export function previewTone(name) {
  const def = TONE_DEFS[name] || TONE_DEFS['Lo-fi'];
  playCycle(def);
}

export function stopTone() {
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = null;
}

export function chirp() {
  blip(880, audio().currentTime + 0.01, 0.12, 'sine', 0.12);
}
