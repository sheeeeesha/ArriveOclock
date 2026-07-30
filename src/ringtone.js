import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { isNative } from './native.js';

// ---------------------------------------------------------------------------
// Custom song ringtones.
//
// WHY EVERYTHING IS DOWNLOADED FIRST (the one rule that shapes this module):
// ArriveO'Clock is a COMMUTE alarm. You are on a metro/train, very often with
// no signal at all. An alarm that streams its audio would go silent exactly
// when it matters most. So a song is always copied to local app storage before
// it can be used, and the native alarm plays it from disk — fully offline.
//
// Two sources, both legal and free:
//   1. YOUR OWN MUSIC — pick any audio file on the device. This is what really
//      delivers "any song": it's your file, already on your phone.
//   2. FREE CATALOG — the Internet Archive's audio collection (public-domain /
//      Creative-Commons). Keyless and CORS-friendly, matching the rest of this
//      app's free+global stack (OpenFreeMap / Photon / OSRM).
//
// Deliberately NOT integrated: Spotify, YouTube/YouTube Music and Apple Music.
// Not an oversight — none of them can legally or technically back an alarm.
// Their SDKs forbid alarm use and give no raw audio, extracting audio breaks
// their ToS, and Apple Music tracks are DRM-protected. Any of those would also
// reintroduce the offline problem above.
// ---------------------------------------------------------------------------

const LS_KEY = 'aoc_ringtone';
const MAX_BYTES = 30 * 1024 * 1024; // 30 MB guard — songs, not albums
const FILE_STEM = 'alarm-ringtone';

// { name, path, uri, source, attribution } | null
let current = load();

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist() {
  try {
    if (current) localStorage.setItem(LS_KEY, JSON.stringify(current));
    else localStorage.removeItem(LS_KEY);
  } catch { /* private mode — the in-memory value still works this session */ }
}

// The saved ringtone, or null when using a built-in synthesised tone.
export function getRingtone() {
  return current;
}

// Absolute on-device path handed to the native alarm plugin (null on web).
export function ringtonePath() {
  return current?.path || null;
}

function extFor(name = '', mime = '') {
  const m = /\.([a-z0-9]{2,4})$/i.exec(name);
  if (m) return m[1].toLowerCase();
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('aac') || mime.includes('mp4')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('ogg')) return 'ogg';
  return 'mp3';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the audio file'));
    // reader gives "data:<mime>;base64,<payload>" — the plugin wants the payload.
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.readAsDataURL(blob);
  });
}

// Write a Blob into app storage and make it the active ringtone.
async function store(blob, { name, source, attribution }) {
  if (!blob || !blob.size) throw new Error('That file appears to be empty');
  if (blob.size > MAX_BYTES) {
    throw new Error(`That file is ${(blob.size / 1048576).toFixed(0)} MB — please pick one under 30 MB`);
  }

  const ext = extFor(name, blob.type);
  const path = `${FILE_STEM}.${ext}`;
  const previous = current;

  if (isNative) {
    await Filesystem.writeFile({
      path,
      data: await blobToBase64(blob),
      directory: Directory.Data,
    });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    current = {
      name,
      source,
      attribution: attribution || '',
      uri,
      // Native players want a plain filesystem path, not a file:// URL.
      path: uri.replace(/^file:\/\//, ''),
    };
    // Drop a previous ringtone with a different extension so we don't leak files.
    if (previous?.path && previous.path !== current.path) {
      const stale = previous.path.split('/').pop();
      try { await Filesystem.deleteFile({ path: stale, directory: Directory.Data }); } catch { /* already gone */ }
    }
  } else {
    // Web has no native alarm; keep it in memory so preview + the in-page alarm
    // still work for this session.
    current = { name, source, attribution: attribution || '', uri: URL.createObjectURL(blob), path: null };
  }

  persist();
  return current;
}

export async function clearRingtone() {
  const previous = current;
  current = null;
  persist();
  if (isNative && previous?.path) {
    const stale = previous.path.split('/').pop();
    try { await Filesystem.deleteFile({ path: stale, directory: Directory.Data }); } catch { /* already gone */ }
  }
}

// A URL the WebView can feed to <audio> for previewing (null if none set).
export function previewSrc() {
  if (!current) return null;
  if (!isNative) return current.uri;
  try { return Capacitor.convertFileSrc(current.uri); } catch { return current.uri; }
}

// --- Source 1: the user's own music ----------------------------------------

// Opens the OS file picker via a plain <input type="file">, which Capacitor's
// WebView maps to the native document/audio picker on both platforms — so this
// needs no extra native plugin. Resolves null if the user cancels.
export function pickLocalAudio() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };

    input.addEventListener('change', () => done(input.files?.[0] || null));
    // No reliable "cancelled" event across platforms; give up once the app has
    // been focused again for a moment with nothing chosen.
    window.addEventListener('focus', () => setTimeout(() => done(input.files?.[0] || null), 1200), { once: true });
    input.click();
  });
}

export async function useLocalFile(file) {
  return store(file, {
    name: file.name.replace(/\.[a-z0-9]{2,4}$/i, ''),
    source: 'device',
  });
}

// --- Source 2: the free Internet Archive catalog ----------------------------

const IA = 'https://archive.org';

// Collections that are genuinely free to download. A bare mediatype:(audio)
// search also returns lending/streaming items whose files are access-restricted
// — those fetch fine as metadata but fail on download, so they are excluded
// here rather than failing later in the user's hands.
const FREE_COLLECTIONS =
  '(collection:(netlabels) OR collection:(musopen) OR collection:(78rpm) OR collection:(etree))';

// Search the Archive's free audio collections. Returns [{ id, title, creator }].
export async function searchFreeMusic(query, signal) {
  const q = `(${query}) AND mediatype:(audio) AND ${FREE_COLLECTIONS} AND NOT access-restricted-item:true`;
  const url =
    `${IA}/advancedsearch.php?q=${encodeURIComponent(q)}` +
    '&fl[]=identifier&fl[]=title&fl[]=creator&rows=25&page=1&output=json';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Search is unavailable right now');
  const json = await res.json();
  return (json?.response?.docs || [])
    .filter((d) => d.identifier)
    .map((d) => ({
      id: d.identifier,
      title: String(d.title || d.identifier),
      creator: String(Array.isArray(d.creator) ? d.creator[0] : d.creator || 'Unknown artist'),
    }));
}

// Resolve an Archive item to a single playable audio file.
async function resolveTrack(id, signal) {
  const res = await fetch(`${IA}/metadata/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) throw new Error('Could not open that item');
  const meta = await res.json();
  const files = (meta?.files || []).filter(
    (f) => /\.(mp3|m4a|ogg|wav)$/i.test(f.name || '') && Number(f.size) > 0
  );
  if (!files.length) throw new Error('That item has no downloadable audio');
  // Prefer a compact MP3 — quickest to fetch and playable on both platforms.
  const score = (f) => (/\.mp3$/i.test(f.name) ? 0 : 1);
  files.sort((a, b) => score(a) - score(b) || Number(a.size) - Number(b.size));
  // Whole concert recordings can run to hundreds of MB; never start one.
  const pick = files.find((f) => Number(f.size) <= MAX_BYTES);
  if (!pick) throw new Error('That recording is too large — try another');
  return {
    url: `${IA}/download/${encodeURIComponent(id)}/${encodeURIComponent(pick.name)}`,
    file: pick.name,
  };
}

// Download an Archive track and make it the active ringtone.
export async function useFreeTrack(item, signal) {
  const { url } = await resolveTrack(item.id, signal);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Download failed — check your connection');
  const blob = await res.blob();
  return store(blob, {
    name: item.title,
    source: 'archive',
    // Creative-Commons material needs credit; keep it with the file.
    attribution: `${item.creator} · archive.org/details/${item.id}`,
  });
}
