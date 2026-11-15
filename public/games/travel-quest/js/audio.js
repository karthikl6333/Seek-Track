/**
 * Short tones from the Web Audio API. Nothing is fetched and nothing plays
 * until the first tap or key, which browsers require.
 */
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let unlocked = false;
  let nextAt = 0;
  let step = 0;

  function context() {
    if (!unlocked || typeof window === 'undefined') return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    } catch {
      return null;
    }
  }

  function beep(freq, dur, type, gain, when, slide) {
    const ac = context();
    if (!ac || muted) return;
    const t = when ?? ac.currentTime;
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(40, freq), t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  return {
    unlock() {
      unlocked = true;
      context();
    },
    setMuted(value) {
      muted = Boolean(value);
      if (muted && ctx) nextAt = ctx.currentTime + 0.05;
    },
    jump() {
      beep(480, 0.09, 'square', 0.03, null, 220);
    },
    collect() {
      beep(660, 0.07, 'sine', 0.045);
      const when = ctx ? ctx.currentTime + 0.06 : undefined;
      beep(880, 0.1, 'sine', 0.04, when);
    },
    hurt() {
      beep(160, 0.16, 'triangle', 0.05, null, -70);
    },
    fact() {
      beep(720, 0.08, 'sine', 0.03);
      const when = ctx ? ctx.currentTime + 0.07 : undefined;
      beep(960, 0.12, 'sine', 0.028, when);
    },
    stamp() {
      [523, 659, 784, 1046].forEach((freq, i) => {
        const when = ctx ? ctx.currentTime + i * 0.09 : undefined;
        beep(freq, 0.16, 'triangle', 0.05, when);
      });
    },
    click() {
      beep(440, 0.04, 'square', 0.02);
    },
    tickMusic(style) {
      const ac = context();
      if (!ac || muted) {
        if (ac) nextAt = ac.currentTime + 0.05;
        return;
      }
      const scale = style === 'night' ? [196, 233, 262, 311, 349, 392] : [262, 294, 330, 392, 440, 523];
      if (nextAt < ac.currentTime) nextAt = ac.currentTime;
      let guard = 0;
      while (nextAt < ac.currentTime + 0.32 && guard < 6) {
        guard += 1;
        const note = scale[step % scale.length];
        if (step % 2 === 0) beep(note, 0.15, 'sine', 0.016, nextAt);
        if (step % 4 === 0) beep(scale[0] / 2, 0.18, 'triangle', 0.012, nextAt);
        step += 1;
        nextAt += 0.28;
      }
    },
  };
}
