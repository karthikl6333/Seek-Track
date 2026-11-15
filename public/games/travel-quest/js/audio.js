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
  let theme = '';

  const themes = {
    map: { step: 0.46, scale: [523, 659, 784, 880], wave: 'sine', gain: 0.011, drone: 262, every: 2 },
    thailand: { step: 0.19, scale: [262, 294, 330, 392, 440, 392, 330, 294], wave: 'triangle', gain: 0.02, drone: 196, every: 1, beat: true },
    vietnam: { step: 0.32, scale: [220, 262, 294, 349, 392, 349, 294, 262], wave: 'sine', gain: 0.017, drone: 110, every: 1, slide: true },
    bangkok: { step: 0.19, scale: [262, 294, 330, 392, 440, 392, 330, 294], wave: 'triangle', gain: 0.02, drone: 196, every: 1, beat: true },
    chiang: { step: 0.28, scale: [262, 311, 349, 392, 466, 392, 349, 311], wave: 'triangle', gain: 0.018, drone: 174, every: 2 },
    phiphi: { step: 0.17, scale: [330, 392, 440, 494, 587, 494, 440, 392], wave: 'triangle', gain: 0.018, drone: 220, every: 1, beat: true },
    hanoi: { step: 0.32, scale: [220, 262, 294, 349, 392, 349, 294, 262], wave: 'sine', gain: 0.017, drone: 110, every: 1, slide: true },
    hoian: { step: 0.36, scale: [196, 247, 294, 330, 392, 330, 294, 247], wave: 'sine', gain: 0.016, drone: 98, every: 2, slide: true },
    halong: { step: 0.3, scale: [247, 294, 330, 392, 494, 392, 330, 294], wave: 'sine', gain: 0.016, drone: 123, every: 2 },
    downtown: { step: 0.16, scale: [330, 392, 494, 587, 659, 587, 494, 392], wave: 'triangle', gain: 0.018, drone: 165, every: 1, beat: true },
    creek: { step: 0.34, scale: [196, 233, 294, 349, 392, 349, 294, 233], wave: 'sine', gain: 0.016, drone: 98, every: 2, slide: true },
    desert: { step: 0.26, scale: [220, 277, 330, 370, 440, 370, 330, 277], wave: 'triangle', gain: 0.017, drone: 110, every: 1, slide: true },
  };

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

  // WebKit throws SyntaxError ("The string did not match the expected pattern.")
  // when an exponential ramp touches zero or is not strictly after the last event.
  function rampTo(param, value, end) {
    const safe = Math.max(0.0001, Number(value) || 0.0001);
    const at = Number(end);
    try {
      param.exponentialRampToValueAtTime(safe, at);
    } catch {
      param.linearRampToValueAtTime(safe, at);
    }
  }

  function beep(freq, dur, type, gain, when, slide) {
    try {
      const ac = context();
      if (!ac || muted) return null;
      const now = ac.currentTime;
      const asked = Number(when);
      const t = Math.max(now + 0.001, Number.isFinite(asked) ? asked : now + 0.001);
      const length = Math.max(0.02, Number(dur) || 0.05);
      const osc = ac.createOscillator();
      const amp = ac.createGain();
      const wave = type === 'square' || type === 'sawtooth' || type === 'triangle' ? type : 'sine';
      osc.type = wave;
      const startFreq = Math.max(40, Number(freq) || 40);
      osc.frequency.setValueAtTime(startFreq, t);
      if (slide) {
        const endFreq = Math.max(40, startFreq + Number(slide));
        if (endFreq !== startFreq) rampTo(osc.frequency, endFreq, t + length);
      }
      const startGain = Math.max(0.0001, Number(gain) || 0.0001);
      amp.gain.setValueAtTime(startGain, t);
      rampTo(amp.gain, 0.0001, t + length);
      osc.connect(amp);
      amp.connect(master);
      osc.start(t);
      osc.stop(t + length + 0.03);
      return null;
    } catch (err) {
      return err;
    }
  }

  function chime(notes, step, dur, type, gain) {
    let failed = null;
    notes.forEach((freq, i) => {
      const when = ctx ? ctx.currentTime + i * step : undefined;
      failed = beep(freq, dur, type, gain, when) || failed;
    });
    if (failed) throw failed;
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
      try {
        chime([523, 659, 784, 1046], 0.09, 0.16, 'triangle', 0.05);
      } catch {
        /* a missed fanfare still lets the stamp screen show */
      }
    },
    checkpoint() {
      chime([784, 988, 1175], 0.07, 0.16, 'sine', 0.055);
    },
    click() {
      beep(440, 0.04, 'square', 0.02);
    },
    tickMusic(name) {
      const song = themes[name] || themes.map;
      if (name !== theme) {
        theme = name;
        step = 0;
        nextAt = 0;
      }
      const ac = context();
      if (!ac || muted) {
        if (ac) nextAt = ac.currentTime + 0.05;
        return;
      }
      if (nextAt < ac.currentTime) nextAt = ac.currentTime;
      let guard = 0;
      while (nextAt < ac.currentTime + 0.45 && guard < 8) {
        guard += 1;
        const note = song.scale[step % song.scale.length];
        if (step % song.every === 0) {
          beep(note, song.step * 0.9, song.wave, song.gain, nextAt, song.slide ? note * 0.04 : 0);
        }
        if (step % 4 === 0) beep(song.drone, song.step * 1.6, 'triangle', song.gain * 0.55, nextAt);
        if (song.beat && step % 2 === 0) beep(note * 2, 0.04, 'square', 0.008, nextAt);
        step += 1;
        nextAt += song.step;
      }
    },
  };
}
