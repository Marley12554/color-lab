/*
 * Every sound is made on the spot with Web Audio, so there are no audio
 * files. Browsers only allow sound after a tap, so the context is created on
 * the first call.
 */
(function () {
  'use strict';

  let ctx = null;
  let master = null;
  let enabled = true;

  function audio() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
      } catch (e) {
        return null;
      }
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // One short note with a quick fade in and out.
  function tone(freq, start, dur, opts) {
    const ac = audio();
    if (!ac) return;
    opts = opts || {};
    const t0 = ac.currentTime + start;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    const peak = opts.gain == null ? 0.25 : opts.gain;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const Sound = {
    setEnabled(on) {
      enabled = !!on;
      if (!enabled && ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    },
    // A soft bubble pop when the pointer moves onto a button. Silent until
    // the page has been tapped once, like every sound, and never starts the
    // audio on its own (browsers only allow that from a tap).
    pop() {
      if (!ctx || ctx.state !== 'running') return;
      const f = 260 + Math.random() * 120;
      tone(f, 0, 0.08, { to: f * 1.9, gain: 0.07 });
    },
    // A short cheerful run for starting a level.
    jingle() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.2, { type: 'triangle', gain: 0.16 }));
      tone(1568, 0.34, 0.25, { gain: 0.07 });
    },
    tap() {
      tone(720, 0, 0.06, { type: 'triangle', gain: 0.15 });
    },
    lift() {
      tone(520, 0, 0.08, { to: 780, gain: 0.14 });
    },
    // A run of little rising bubbles, pitched by how full the target gets.
    pour(layers, fill) {
      const base = 260 + fill * 260;
      const count = 3 + Math.min(5, layers * 2);
      for (let i = 0; i < count; i++) {
        const f = base * (1 + Math.random() * 0.25) + i * 18;
        tone(f, i * 0.055, 0.07, { to: f * 1.6, gain: 0.12 });
      }
    },
    seal() {
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.07, 0.22, { type: 'triangle', gain: 0.16 }));
    },
    win() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.35, { type: 'triangle', gain: 0.2 }));
      [1568, 2093].forEach((f, i) => tone(f, 0.6 + i * 0.09, 0.4, { gain: 0.08 }));
    },
    oops() {
      tone(240, 0, 0.12, { type: 'square', gain: 0.06, to: 200 });
      tone(180, 0.11, 0.16, { type: 'square', gain: 0.06, to: 150 });
    },
    hint() {
      tone(988, 0, 0.12, { gain: 0.15 });
      tone(1319, 0.1, 0.2, { gain: 0.15 });
    },
    whoosh() {
      tone(300, 0, 0.25, { to: 900, gain: 0.08, type: 'triangle' });
    },
  };

  window.ColorLabSound = Sound;
})();
