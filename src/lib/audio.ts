// Audio feedback via the Web Audio API — no audio files required.
//   success: bright two-note chime (emerald / IN or OUT)
//   alert:   low warning buzz (blocked)
//   unknown: short neutral tone (unrecognized QR)

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, type: OscillatorType, volume = 0.18): void {
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, c.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(volume, c.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + duration + 0.05);
}

export function playSuccess(): void {
  tone(880, 0, 0.18, 'sine');
  tone(1318.5, 0.12, 0.3, 'sine');
}

export function playAlert(): void {
  tone(196, 0, 0.4, 'sawtooth', 0.22);
  tone(147, 0.15, 0.4, 'sawtooth', 0.2);
}

export function playUnrecognized(): void {
  tone(440, 0, 0.22, 'triangle', 0.16);
  tone(330, 0.2, 0.22, 'triangle', 0.16);
}
