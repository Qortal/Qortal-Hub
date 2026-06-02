/**
 * Synthesized DM call tones (Web Audio API — no sound files).
 */

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * @returns Stop function: silences, clears timers, closes the AudioContext.
 */
export function startDirectIncomingRingtone(): () => void {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return () => {};

  const ctx = new Ctor();
  let stopped = false;
  let scheduleTimer: ReturnType<typeof setTimeout> | null = null;

  /** C5 + E5 — warm, clear, not shrill at low level */
  const f1 = 523.25;
  const f2 = 659.25;
  const CYCLE_MS = 2800;
  const PEAK = 0.11;

  const playChimePair = (baseTime: number) => {
    const chime = (start: number) => {
      const g = ctx.createGain();
      g.connect(ctx.destination);
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'sine';
      o2.type = 'sine';
      o1.frequency.value = f1;
      o2.frequency.value = f2;
      o1.connect(g);
      o2.connect(g);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(PEAK, start + 0.04);
      g.gain.linearRampToValueAtTime(PEAK * 0.55, start + 0.22);
      g.gain.exponentialRampToValueAtTime(0.0008, start + 0.58);
      o1.start(start);
      o2.start(start);
      o1.stop(start + 0.62);
      o2.stop(start + 0.62);
    };

    chime(baseTime);
    chime(baseTime + 0.62);
  };

  const tick = () => {
    if (stopped) return;
    void ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    playChimePair(now + 0.03);

    scheduleTimer = window.setTimeout(tick, CYCLE_MS);
  };

  tick();

  return () => {
    stopped = true;
    if (scheduleTimer !== null) {
      window.clearTimeout(scheduleTimer);
      scheduleTimer = null;
    }
    void ctx.close();
  };
}

/**
 * @returns Stop function: silences, clears timers, closes the AudioContext.
 */
export function startDirectOutboundRingtone(): () => void {
  return startDirectIncomingRingtone();
}
