/**
 * iOS-style scroll tick sound — production-grade, zero external assets.
 *
 * Design decisions (why it's reliable across browsers/OSes):
 *  - We synthesize a short click into an AudioBuffer ONCE at init, then play
 *    it back via AudioBufferSourceNode. BufferSource is the most widely-supported,
 *    lowest-latency path in Web Audio (works on Safari/iOS, Chrome, Firefox, Edge).
 *  - Pitch is controlled via `playbackRate` (no re-synthesis per tick).
 *  - Volume is controlled via a per-tick GainNode.
 *  - AudioContext is created AND resumed inside the first real user gesture,
 *    using capture-phase listeners so we beat any stopPropagation() downstream.
 *    Browsers (esp. Chrome/Safari) will keep the context suspended otherwise.
 *  - If Web Audio is entirely unavailable, everything becomes a no-op (no throws).
 *  - Exposes `setTickSoundEnabled` + `isTickSoundEnabled` + a localStorage-backed
 *    mute preference so the user toggle persists.
 */

const TICK_DISTANCE_BASE = 55; // px between ticks at baseline
const TICK_DISTANCE_MIN = 16;
const MIN_GAIN = 0.25;
const MAX_GAIN = 0.9;
const MIN_RATE = 0.85;
const MAX_RATE = 1.9;
const MIN_INTERVAL_MS = 14; // hard cap: never more than ~70 ticks/sec
const STORAGE_KEY = 'boxyy.sound.enabled';

type AC = AudioContext;

let ctx: AC | null = null;
let masterGain: GainNode | null = null;
let clickBuffer: AudioBuffer | null = null;
let initTried = false;
let unlocked = false;
let enabled = loadPref();
let accum = 0;
let lastTickAt = 0;
let recentSpeed = 0; // EMA of px/ms

function loadPref(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

function savePref(v: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
  } catch {}
}

function getACtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (window.AudioContext || (window as any).webkitAudioContext) ?? null;
}

function buildClickBuffer(ac: AC): AudioBuffer {
  // 30ms click: fast attack, exponential decay, dominant ~1.1kHz sine with a tiny
  // noise transient at the very start for "tock" character.
  const sr = ac.sampleRate;
  const length = Math.floor(sr * 0.03);
  const buf = ac.createBuffer(1, length, sr);
  const data = buf.getChannelData(0);
  const freq = 1100;
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 90); // fast decay
    const body = Math.sin(2 * Math.PI * freq * t) * env;
    const transient = i < 30 ? (Math.random() * 2 - 1) * env * 0.4 : 0;
    data[i] = (body + transient) * 0.9;
  }
  return buf;
}

function ensureContext(): AC | null {
  if (ctx) return ctx;
  if (initTried) return null;
  initTried = true;
  const Ctor = getACtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
    clickBuffer = buildClickBuffer(ctx);
  } catch {
    ctx = null;
    return null;
  }
  return ctx;
}

function unlockFromGesture() {
  const ac = ensureContext();
  if (!ac) return;
  // Resume if suspended (required on Chrome/Safari).
  if (ac.state === 'suspended') {
    ac.resume().catch(() => {});
  }
  // Play a silent buffer immediately inside the gesture. This is the trick that
  // reliably unlocks audio on iOS Safari even when resume() alone isn't enough.
  try {
    const src = ac.createBufferSource();
    const silent = ac.createBuffer(1, 1, 22050);
    src.buffer = silent;
    src.connect(ac.destination);
    src.start(0);
  } catch {}
  unlocked = true;
}

/**
 * Attach one-time unlock listeners in the capture phase so they fire before any
 * stopPropagation() inside the app.
 */
export function initTickSoundOnGesture() {
  if (typeof window === 'undefined') return;
  const handler = () => {
    unlockFromGesture();
    window.removeEventListener('pointerdown', handler, true);
    window.removeEventListener('touchstart', handler, true);
    window.removeEventListener('wheel', handler, true);
    window.removeEventListener('keydown', handler, true);
  };
  window.addEventListener('pointerdown', handler, { capture: true });
  window.addEventListener('touchstart', handler, { capture: true, passive: true });
  window.addEventListener('wheel', handler, { capture: true, passive: true });
  window.addEventListener('keydown', handler, { capture: true });
}

function playClick(speed: number) {
  const ac = ctx;
  if (!ac || !clickBuffer || !masterGain) return;
  if (ac.state !== 'running') {
    ac.resume().catch(() => {});
    return; // skip this tick; next one will be audible
  }

  // Map speed (px/ms, ~0..3) to rate + gain.
  const s = Math.max(0, Math.min(1, speed / 3));
  const rate = MIN_RATE + (MAX_RATE - MIN_RATE) * s;
  const gainVal = MIN_GAIN + (MAX_GAIN - MIN_GAIN) * s;

  try {
    const src = ac.createBufferSource();
    src.buffer = clickBuffer;
    src.playbackRate.value = rate;
    const g = ac.createGain();
    g.gain.value = gainVal;
    src.connect(g).connect(masterGain);
    src.start();
    src.onended = () => {
      try {
        src.disconnect();
        g.disconnect();
      } catch {}
    };
  } catch {
    // swallow — never break scrolling because of audio
  }
}

export function setTickSoundEnabled(v: boolean) {
  enabled = v;
  savePref(v);
  if (v) ensureContext();
}

export function isTickSoundEnabled() {
  return enabled;
}

export function isTickSoundReady() {
  return unlocked && !!ctx;
}

/**
 * Fire one tick — call this exactly when a box boundary is crossed.
 * Speed is auto-derived from time since the previous tick: faster crossings →
 * higher pitch and louder click, slower crossings → softer.
 */
export function tickOnBoxCross() {
  if (!enabled) return;
  const now = performance.now();
  const dt = lastTickAt ? now - lastTickAt : 400;
  // Map dt (ms between box crossings) to a normalized speed in [0..1].
  // 400ms+ between boxes = slow; ~80ms between boxes = fast fling.
  const s = Math.max(0, Math.min(1, (400 - dt) / 320));
  recentSpeed = recentSpeed * 0.5 + s * 0.5;
  if (now - lastTickAt >= MIN_INTERVAL_MS) {
    playClick(recentSpeed);
    lastTickAt = now;
  }
}

export function resetTickAccumulator() {
  accum = 0;
  recentSpeed = 0;
  lastTickAt = 0;
}
