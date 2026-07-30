// ---------------------------------------------------------------------------
// Built-in alarm tones, synthesised with the Web Audio API. No audio files to
// ship; each tone is a short motif. playTone() loops it (the alarm);
// previewTone() plays one cycle (tapping a tone in Settings).
// ---------------------------------------------------------------------------

import { previewSrc } from './ringtone.js';

let ctx = null;
let loopTimer = null;
let songEl = null; // <audio> for a chosen song ringtone

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

// --- Chosen song ringtones (see ringtone.js) -------------------------------
// Used by the in-page alarm on web, and for previewing the pick in Settings.
// On native the song is played by the OS alarm itself, not from here.

export function playRingtone({ loop = true, seconds = 0 } = {}) {
  stopTone();
  const src = previewSrc();
  if (!src) return false;
  songEl = new Audio(src);
  songEl.loop = loop;
  songEl.volume = 1;
  // Autoplay can be refused until the user has interacted with the page; every
  // caller here is a tap, so this only guards the odd edge case.
  songEl.play().catch(() => {});
  if (seconds > 0) setTimeout(() => stopRingtone(), seconds * 1000);
  return true;
}

// Short taste of the chosen song when tapping it in Settings.
export function previewRingtone() {
  return playRingtone({ loop: false, seconds: 12 });
}

export function stopRingtone() {
  if (songEl) {
    try { songEl.pause(); } catch { /* already stopped */ }
    songEl = null;
  }
}

export function stopTone() {
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = null;
  stopRingtone();
}

export function chirp() {
  blip(880, audio().currentTime + 0.01, 0.12, 'sine', 0.12);
}
