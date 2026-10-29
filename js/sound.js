/*
 * Every sound is made on the spot with Web Audio, so there are no audio
 * files. Browsers only allow sound after a tap, so the context is created on
 * the first call.
 */
(function () {
  'use strict';

  let ctx = null;
  let master = null;
  let bubbleBus = null;
  let enabled = true;
  let bubbling = false;
  let bubbleTimer = 0;

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
      bubbleBus = ctx.createGain();
      bubbleBus.gain.value = 0.35;
      bubbleBus.connect(master);
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
    gain.connect(opts.bus || master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /*
   * Background bubbling for the title screen: soft random blips, sometimes
   * in little clusters. It only sounds once the page may play audio (after
   * the first tap) and goes quiet while the tab is hidden.
   */
  function bubbleTick() {
    bubbleTimer = 0;
    if (!bubbling) return;
    if (enabled && ctx && ctx.state === 'running' && !document.hidden) {
      const count = Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 2) : 1;
      for (let i = 0; i < count; i++) {
        const f = 170 + Math.random() * 260;
        const dur = 0.07 + Math.random() * 0.07;
        tone(f, i * (0.06 + Math.random() * 0.05), dur, { to: f * (1.6 + Math.random() * 0.5), gain: 0.16, bus: bubbleBus });
      }
    }
    bubbleTimer = setTimeout(bubbleTick, 220 + Math.random() * 650);
  }

  const Sound = {
    setEnabled(on) {
      enabled = !!on;
      if (!enabled && ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    },
    // Starts or stops the title screen's background bubbling.
    bubbles(on) {
      bubbling = !!on;
      if (bubbling && !bubbleTimer) bubbleTimer = setTimeout(bubbleTick, 300);
      if (!bubbling && bubbleTimer) {
        clearTimeout(bubbleTimer);
        bubbleTimer = 0;
      }
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
