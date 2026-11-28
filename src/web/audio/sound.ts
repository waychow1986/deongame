import type { SoundName } from '../../shared/ui/events.js';

/**
 * Synthesised sound effects (TD-015). Mute lives in module memory only: it survives navigation inside
 * the site but not a page reload (R3). Every request is reported as a `deongame:sound` event.
 */
let muted = false;
let ctx: AudioContext | null = null;
let unlocked = false;
const listeners = new Set<() => void>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  for (const l of listeners) l();
}

export function subscribeMuted(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function unlock(): void {
  const ac = audioContext();
  if (!ac) return;
  void ac.resume().catch(() => undefined);
  // One silent frame inside the user gesture unlocks output on mobile browsers.
  const buf = ac.createBuffer(1, 1, 22050);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.start(0);
  unlocked = true;
}

let installed = false;
/** Unlocks audio on the first tap, click or key press (FR-093). */
export function installAudioUnlock(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlock, { capture: true });
}

interface Tone {
  freq: number;
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  at?: number;
}

const TONES: Record<SoundName, Tone[]> = {
  'chess-move': [{ freq: 180, to: 90, dur: 0.09, type: 'triangle', gain: 0.5 }],
  'chess-flip': [{ freq: 520, to: 880, dur: 0.12, type: 'sine', gain: 0.25 }],
  'chess-capture': [
    { freq: 140, to: 60, dur: 0.16, type: 'square', gain: 0.25 },
    { freq: 300, to: 120, dur: 0.1, type: 'triangle', gain: 0.3, at: 0.03 },
  ],
  'chess-check': [
    { freq: 660, dur: 0.12, type: 'square', gain: 0.15 },
    { freq: 880, dur: 0.16, type: 'square', gain: 0.15, at: 0.13 },
  ],
  'chess-end': [
    { freq: 523, dur: 0.18, gain: 0.25 },
    { freq: 659, dur: 0.18, gain: 0.25, at: 0.16 },
    { freq: 784, dur: 0.3, gain: 0.25, at: 0.32 },
  ],
  'poker-deal': [{ freq: 1200, to: 500, dur: 0.05, type: 'sawtooth', gain: 0.12 }],
  'poker-bet': [
    { freq: 1800, dur: 0.05, type: 'triangle', gain: 0.2 },
    { freq: 2200, dur: 0.05, type: 'triangle', gain: 0.2, at: 0.05 },
  ],
  'poker-fold': [{ freq: 400, to: 200, dur: 0.12, type: 'sine', gain: 0.2 }],
  'poker-win': [
    { freq: 784, dur: 0.12, gain: 0.25 },
    { freq: 988, dur: 0.12, gain: 0.25, at: 0.1 },
    { freq: 1319, dur: 0.25, gain: 0.25, at: 0.2 },
  ],
};

function synth(ac: AudioContext, name: SoundName): void {
  const now = ac.currentTime;
  for (const t of TONES[name]) {
    const start = now + (t.at ?? 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, start);
    if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
    gain.gain.setValueAtTime(t.gain ?? 0.2, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + t.dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + t.dur + 0.02);
  }
}

export function playSound(name: SoundName): void {
  const played = !muted && unlocked && ctx !== null;
  if (played && ctx) {
    try {
      synth(ctx, name);
    } catch {
      // Audio output failures never affect the game.
    }
  }
  window.dispatchEvent(new CustomEvent('deongame:sound', { detail: { name, played } }));
}
