/*
 * Color Lab: screens, the tube board, pouring animations, and progress.
 * The rules, solver, and level generator live in core.js; heavy work runs in
 * the worker so the page stays smooth.
 */
(function () {
  'use strict';

  const Core = window.ColorLabCore;
  const Sound = window.ColorLabSound;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const rootStyle = getComputedStyle(document.documentElement);
  const PALETTE = Array.from({ length: Core.PALETTE_SIZE }, (_, i) => rootStyle.getPropertyValue('--c' + i).trim());
  const COLOR_NAMES = ['red', 'orange', 'yellow', 'lime', 'green', 'aqua', 'sky blue', 'blue', 'purple', 'pink', 'brown', 'gray'];
  const LAB_COLORS = ['#0e9aad', '#ee6c1f', '#e93f72', '#2a85e8', '#14a06f', '#7a4bf0', '#d4541e'];

  // Shapes for color helper mode, one per sample color (24 by 24 viewBox).
  const SHAPES = [
    '<circle cx="12" cy="12" r="6.5"/>',
    '<path d="M12 4.5 19.5 18h-15z"/>',
    '<path d="M6 6h12v12H6z"/>',
    '<path d="m12 3.5 8.5 8.5-8.5 8.5L3.5 12z"/>',
    '<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    '<path d="M9.8 4.5h4.4v5.3h5.3v4.4h-5.3v5.3H9.8v-5.3H4.5V9.8h5.3z"/>',
    '<path d="M12 20s-7.5-4.6-7.5-10A4.1 4.1 0 0 1 12 7.6 4.1 4.1 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    '<path d="m12 3.5 7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z"/>',
    '<path fill-rule="evenodd" d="M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 1 0 0-15zm0 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 1 1 0-7z"/>',
    '<path d="M15 3.8a8.3 8.3 0 1 0 5.4 13.6A7.2 7.2 0 0 1 15 3.8z"/>',
    '<path d="M13.5 2.5 5.5 13.5h5.5l-1 8 8-11h-5.5z"/>',
    '<path d="m7.6 5.4 4.4 4.4 4.4-4.4 2.2 2.2-4.4 4.4 4.4 4.4-2.2 2.2-4.4-4.4-4.4 4.4-2.2-2.2 4.4-4.4-4.4-4.4z"/>',
  ];

  const ICONS = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24"><path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24"><path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/></svg>',
    hint: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.6V16h6v-.1c0-.6.3-1.2.8-1.6A6.5 6.5 0 0 0 12 2.5z"/></svg>',
    tube: '<svg viewBox="0 0 24 24"><path d="M5 3h7"/><path d="M6 3v13.5a2.5 2.5 0 0 0 5 0V3"/><path d="M18 8v8M14 12h8"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2.5 0h5V8a2.5 2.5 0 0 0-5 0z"/></svg>',
  };

  // Tube proportions, in tube widths.
  const UNIT = 0.9; // one layer of liquid
  const NECK = 0.62; // space above a full tube
  const LIFT = 0.55; // room above each row for a lifted tube
  const GAP_X = 0.5;
  const GAP_Y = 0.5;
  const MAX_W = 78;

  const INTROS = {
    1: 'Tap a tube, then tap another tube to pour. Matching colors stack!',
    2: 'Empty tubes can hold any color.',
    21: 'Taller tubes! Each one holds 5 layers.',
    31: 'Only one empty tube now. Think before you pour!',
    35: 'Mystery samples! Gray layers show their color when you uncover them.',
    45: 'Super tall tubes: 6 layers each!',
  };
  const CHEERS = ["Let's sort these samples!", 'Ready, scientist?', 'Time for some science!', 'Sort it, pour it, seal it!', 'You can do it!'];
  const SEALS = ['Tube complete!', 'Sealed it!', 'Perfect pour!', 'Super sorting!', 'Nice one!'];
  const DIFFS = ['easy', 'medium', 'hard', 'genius'];

  // ---------- Saved progress (this browser only) ----------

  const STORE_KEY = 'color-lab-v1';

  function defaults() {
    return {
      unlocked: 1,
      stars: {},
      best: {},
      sound: true,
      shapes: false,
      custom: { colors: 6, cap: 4, empties: 2, difficulty: 'medium', mystery: false },
    };
  }

  function load() {
    const base = defaults();
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        return Object.assign(base, data, { custom: Object.assign(base.custom, data.custom) });
      }
    } catch (e) {
      /* storage blocked or corrupt: start fresh */
    }
    return base;
  }

  const saved = load();

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch (e) {
      /* progress just will not persist */
    }
  }

  // ---------- Background jobs ----------

  const jobs = new Map();
  let jobId = 0;
  let worker = null;

  function runLocal(type, payload) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          if (type === 'level') resolve(Core.generateLevel(payload.level));
          else if (type === 'custom') resolve(Core.generate(payload));
          else resolve(Core.solve(payload.tubes, payload.cap, { weight: 2, maxNodes: payload.maxNodes || 60000 }));
        } catch (err) {
          reject(err);
        }
      }, 0);
    });
  }

  function startWorker() {
    try {
      if (window.COLOR_LAB_WORKER_SRC) {
        const blob = new Blob([window.COLOR_LAB_WORKER_SRC], { type: 'text/javascript' });
        worker = new Worker(URL.createObjectURL(blob));
      } else {
        worker = new Worker('js/worker.js');
      }
    } catch (e) {
      worker = null;
      return;
    }
    worker.onmessage = (e) => {
      const entry = jobs.get(e.data.id);
      if (!entry) return;
      jobs.delete(e.data.id);
      if (e.data.error) entry.reject(new Error(e.data.error));
      else entry.resolve(e.data.result);
    };
    // A worker that cannot load (for example when the page is opened as a
    // file) hands its jobs back to the page.
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      worker = null;
      const pending = Array.from(jobs.values());
      jobs.clear();
      pending.forEach((j) => runLocal(j.type, j.payload).then(j.resolve, j.reject));
    };
  }

  function job(type, payload) {
    if (!worker) return runLocal(type, payload);
    return new Promise((resolve, reject) => {
      const id = ++jobId;
      jobs.set(id, { resolve, reject, type, payload });
      worker.postMessage({ id, type, payload });
    });
  }

  const levelCache = new Map();

  function getLevel(n) {
    if (!levelCache.has(n)) {
      levelCache.set(
        n,
        job('level', { level: n }).catch((err) => {
          levelCache.delete(n);
          throw err;
        })
      );
    }
    return levelCache.get(n);
  }

  // ---------- Screens ----------

  let screen = 'home';

  function show(name) {
    screen = name;
    ['home', 'levels', 'custom', 'play'].forEach((id) => {
      $(id).hidden = id !== name;
    });
    $('win').hidden = true;
    if (name === 'home') renderHome();
    if (name === 'levels') renderLevels();
    if (name === 'custom') renderCustom();
  }

  function labColor(index) {
    return LAB_COLORS[index % LAB_COLORS.length];
  }

  function setLab(index) {
    document.documentElement.style.setProperty('--lab', labColor(index));
  }

  function renderHome() {
    const n = saved.unlocked;
    const lab = Core.labOf(n);
    $('playSub').textContent = 'Experiment ' + n + ' · ' + lab.name;
    $('soundToggle').checked = saved.sound;
    $('shapesToggle').checked = saved.shapes;
  }

  function renderLevels() {
    const list = $('labList');
    list.innerHTML = '';
    const lastLab = Core.labOf(saved.unlocked).index + 1;
    for (let i = 0; i <= lastLab; i++) {
      const first = i * 10 + 1;
      const lab = Core.labOf(first);
      let earned = 0;
      for (let n = first; n < first + 10; n++) earned += saved.stars[n] || 0;
      const section = document.createElement('section');
      section.className = 'lab';
      section.style.setProperty('--lab', labColor(i));
      section.innerHTML =
        '<div class="lab-head"><h3>' + lab.name + '</h3><span>' + earned + ' of 30 stars</span></div><div class="level-grid"></div>';
      const grid = section.querySelector('.level-grid');
      for (let n = first; n < first + 10; n++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-btn' + (n === saved.unlocked ? ' current' : '');
        if (n > saved.unlocked) {
          btn.disabled = true;
          btn.innerHTML = ICONS.lock;
          btn.setAttribute('aria-label', 'Experiment ' + n + ', locked');
        } else {
          const stars = saved.stars[n] || 0;
          btn.innerHTML =
            '<span>' + n + '</span><span class="mini-stars">' +
            [1, 2, 3].map((s) => '<i class="' + (s <= stars ? 'on' : '') + '"></i>').join('') +
            '</span>';
          btn.setAttribute('aria-label', 'Experiment ' + n + ', ' + stars + ' stars');
          btn.addEventListener('click', () => startLevel(n));
        }
        grid.appendChild(btn);
      }
      list.appendChild(section);
    }
    const current = list.querySelector('.current');
    if (current) current.scrollIntoView({ block: 'center' });
  }

  // ---------- Custom mixes ----------

  function clampCustom() {
    const c = saved.custom;
    c.cap = Math.min(6, Math.max(3, c.cap));
    c.empties = Math.min(3, Math.max(1, c.empties));
    const max = Core.maxColorsFor(c.cap, c.empties);
    const clamped = c.colors > max;
    c.colors = Math.min(max, Math.max(2, c.colors));
    return { max, clamped };
  }

  function renderCustom(clampedNow) {
    const c = saved.custom;
    const { max } = clampCustom();
    $('colorsOut').textContent = c.colors;
    $('capOut').textContent = c.cap;
    $('emptiesOut').textContent = c.empties;
    const limits = { colors: [2, max], cap: [3, 6], empties: [1, 3] };
    document.querySelectorAll('.stepper').forEach((row) => {
      const key = row.dataset.key;
      row.querySelector('[data-step="-1"]').disabled = c[key] <= limits[key][0];
      row.querySelector('[data-step="1"]').disabled = c[key] >= limits[key][1];
    });
    const note = $('sizeNote');
    note.hidden = !(c.empties === 1 || clampedNow);
    note.textContent = 'With one empty tube, up to ' + max + ' colors fit in tubes this size.';
    if (c.empties > 1 && clampedNow) note.textContent = 'Up to ' + max + ' colors.';
    document.querySelectorAll('input[name="difficulty"]').forEach((r) => {
      r.checked = r.value === c.difficulty;
    });
    $('mysteryToggle').checked = c.mystery;
  }

  function customCode(spec) {
    return (
      String(spec.colors).padStart(2, '0') + spec.cap + spec.empties + DIFFS.indexOf(spec.difficulty) + (spec.mystery ? 1 : 0) + '-' + spec.seed
    );
  }

  function parseCode(text) {
    const m = /^\s*(\d{2})(\d)(\d)(\d)([01])\s*-?\s*(\d{1,6})\s*$/.exec(text || '');
    if (!m) return null;
    const spec = {
      colors: +m[1],
      cap: +m[2],
      empties: +m[3],
      difficulty: DIFFS[+m[4]],
      mystery: m[5] === '1',
      seed: +m[6],
    };
    if (!spec.difficulty || spec.cap < 3 || spec.cap > 6 || spec.empties < 1 || spec.empties > 3) return null;
    if (spec.colors < 2 || spec.colors > Core.maxColorsFor(spec.cap, spec.empties)) return null;
    return spec;
  }

  function newCustomSpec() {
    clampCustom();
    return Object.assign({}, saved.custom, { seed: 1000 + Math.floor(Math.random() * 9000) });
  }

  // ---------- The game ----------

  const board = $('board');
  const game = {
    mode: 'level',
    level: 1,
    custom: null,
    puzzle: null,
    cap: 4,
    tubes: [],
    hidden: [],
    history: [],
    helps: { undos: Infinity, hints: 3, extraTubes: 1 },
    helped: false,
    selected: -1,
    busy: false,
    done: false,
    hint: null,
    hintPending: false,
    loadToken: 0,
    checkToken: 0,
  };
  let tubeEls = [];
  let rackEls = [];
  let positions = [];
  let unit = 40;
  let needsLayout = false;

  function colorOf(c) {
    return PALETTE[game.palette[c]];
  }

  function nameOf(c) {
    return COLOR_NAMES[game.palette[c]];
  }

  function say(text) {
    const el = $('say');
    el.textContent = text;
    el.classList.remove('alert');
    const robot = document.querySelector('.robot');
    robot.classList.remove('talk');
    void robot.getBoundingClientRect();
    robot.classList.add('talk');
  }

  function pickFrom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function beginLoading(labName, title) {
    game.puzzle = null;
    game.done = false;
    game.busy = false;
    game.checkToken++;
    clearHint();
    board.innerHTML = '';
    tubeEls = [];
    rackEls = [];
    clearStuck();
    $('labName').textContent = labName;
    $('levelTitle').textContent = title;
    $('moveCount').textContent = '0';
    $('loading').hidden = false;
    say('Mixing up your samples…');
    updateHud();
  }

  async function startLevel(n) {
    game.mode = 'level';
    game.level = n;
    game.custom = null;
    const lab = Core.labOf(n);
    setLab(lab.index);
    show('play');
    beginLoading(lab.name, 'Experiment\u00a0' + n);
    const token = ++game.loadToken;
    let puzzle;
    try {
      puzzle = await getLevel(n);
    } catch (err) {
      if (token === game.loadToken) say('Oops, the mixer jammed. Go back and try again!');
      return;
    }
    if (token !== game.loadToken) return;
    setPuzzle(puzzle);
    getLevel(n + 1).catch(() => {});
  }

  async function startCustom(spec) {
    game.mode = 'custom';
    game.custom = spec;
    setLab(5);
    show('play');
    beginLoading('Your mix', 'Lab code ' + customCode(spec));
    const token = ++game.loadToken;
    let puzzle;
    try {
      puzzle = await job('custom', {
        colors: spec.colors,
        cap: spec.cap,
        empties: spec.empties,
        difficulty: spec.difficulty,
        seed: 'custom:' + spec.seed,
      });
    } catch (err) {
      puzzle = null;
    }
    if (token !== game.loadToken) return;
    if (!puzzle) {
      say("I couldn't mix that one. Try a smaller size!");
      return;
    }
    puzzle.mystery = spec.mystery;
    setPuzzle(puzzle);
  }

  function setPuzzle(puzzle) {
    $('loading').hidden = true;
    game.puzzle = puzzle;
    game.cap = puzzle.cap;
    game.palette = puzzle.palette;
    resetBoard();
    let line;
    if (game.mode === 'level' && INTROS[game.level]) line = INTROS[game.level];
    else if (puzzle.mystery) line = 'Mystery samples! Gray layers show their color when you uncover them.';
    else line = pickFrom(CHEERS);
    say(line);
    if (game.mode === 'level' && game.level === 1) autoHint();
  }

  function resetBoard() {
    const p = game.puzzle;
    game.tubes = Core.cloneTubes(p.tubes);
    game.hidden = game.tubes.map((t) => (p.mystery ? t.length - Core.topRun(t).count : 0));
    game.history = [];
    game.selected = -1;
    game.done = false;
    game.helped = false;
    game.busy = false;
    game.checkToken++;
    game.helps = Object.assign({}, Core.helpsFor(game.mode === 'level' ? { level: game.level } : { difficulty: game.custom.difficulty }));
    clearStuck();
    clearHint();
    buildBoard();
    updateHud();
  }

  // Layers become visible once they are part of a tube's top section, and
  // stay visible after that.
  function normalizeHidden() {
    while (game.hidden.length < game.tubes.length) game.hidden.push(0);
    game.tubes.forEach((t, i) => {
      game.hidden[i] = Math.max(0, Math.min(game.hidden[i], t.length - Core.topRun(t).count));
    });
  }

  // ---------- Board ----------

  function makeTube(i) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tube';
    el.innerHTML = '<span class="glass"><span class="liquid"></span></span><span class="lip"></span><span class="stopper"></span>';
    el.addEventListener('click', () => onTube(i));
    return el;
  }

  function buildBoard() {
    board.innerHTML = '';
    tubeEls = game.tubes.map((_, i) => {
      const el = makeTube(i);
      board.appendChild(el);
      return el;
    });
    rackEls = [];
    layout();
    renderAll();
  }

  function layout() {
    const n = tubeEls.length;
    if (!n) return;
    const cap = game.cap;
    const bw = board.clientWidth;
    const bh = board.clientHeight;
    if (!bw || !bh) return;

    let best = null;
    for (let rows = 1; rows <= Math.min(4, n); rows++) {
      const per = Math.ceil(n / rows);
      const byWidth = bw / (per + GAP_X * (per - 1));
      const byHeight = bh / (rows * (cap * UNIT + NECK + LIFT) + (rows - 1) * GAP_Y);
      const w = Math.min(byWidth, byHeight, MAX_W);
      if (!best || w > best.w + 0.5) best = { rows, w };
    }
    const w = Math.floor(best.w);
    const th = w * (cap * UNIT + NECK);
    unit = w * UNIT;
    board.style.setProperty('--w', w + 'px');
    board.style.setProperty('--unit', unit + 'px');

    const sizes = [];
    let left = n;
    for (let r = 0; r < best.rows; r++) {
      const k = Math.ceil(left / (best.rows - r));
      sizes.push(k);
      left -= k;
    }
    const rowStep = th + w * (LIFT + GAP_Y);
    const blockH = best.rows * (th + w * LIFT) + (best.rows - 1) * w * GAP_Y;
    const y0 = Math.max(0, (bh - blockH) / 2) + w * LIFT;

    rackEls.forEach((r) => r.remove());
    rackEls = [];
    positions = [];
    let idx = 0;
    sizes.forEach((k, r) => {
      const rowW = k * w + (k - 1) * w * GAP_X;
      const x0 = (bw - rowW) / 2;
      const y = y0 + r * rowStep;
      for (let j = 0; j < k; j++, idx++) {
        const x = x0 + j * w * (1 + GAP_X);
        positions[idx] = { x, y, w, h: th };
        const el = tubeEls[idx];
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.width = w + 'px';
        el.style.height = th + 'px';
      }
      const rack = document.createElement('div');
      rack.className = 'rack';
      rack.style.left = x0 - w * 0.35 + 'px';
      rack.style.width = rowW + w * 0.7 + 'px';
      rack.style.top = y + th - w * 1.05 + 'px';
      rack.style.height = w * 0.44 + 'px';
      board.insertBefore(rack, board.firstChild);
      rackEls.push(rack);
    });
  }

  function segHtml(seg, isTop) {
    let inner = '';
    if (seg.hidden) inner = '<span class="unit">?</span>';
    else if (saved.shapes) {
      const svg = '<svg viewBox="0 0 24 24" aria-hidden="true">' + SHAPES[game.palette[seg.color]] + '</svg>';
      for (let k = 0; k < seg.n; k++) inner += '<span class="unit">' + svg + '</span>';
    }
    const style = '--n:' + seg.n + (seg.hidden ? '' : ';--c:' + colorOf(seg.color));
    return (
      '<span class="seg' + (isTop ? ' top' : '') + (seg.hidden ? ' hidden' : '') + '" style="' + style + '" data-color="' +
      (seg.hidden ? '' : seg.color) + '">' + inner + '</span>'
    );
  }

  function describe(i) {
    const t = game.tubes[i];
    if (!t.length) return 'Tube ' + (i + 1) + ', empty';
    if (Core.isSealed(t, game.cap)) return 'Tube ' + (i + 1) + ', finished, all ' + nameOf(t[0]);
    const names = t.map((c, k) => (k < game.hidden[i] ? 'mystery' : nameOf(c)));
    return 'Tube ' + (i + 1) + ', bottom to top: ' + names.join(', ');
  }

  function renderTube(i) {
    const el = tubeEls[i];
    const tube = game.tubes[i];
    const hidden = game.hidden[i] || 0;
    const segs = [];
    for (let k = 0; k < tube.length; k++) {
      const isHidden = k < hidden;
      const last = segs[segs.length - 1];
      if (!isHidden && last && !last.hidden && last.color === tube[k]) last.n++;
      else segs.push({ color: tube[k], n: 1, hidden: isHidden });
    }
    el.querySelector('.liquid').innerHTML = segs.map((s, si) => segHtml(s, si === segs.length - 1)).join('');
    const sealed = Core.isSealed(tube, game.cap);
    el.classList.toggle('sealed', sealed);
    if (sealed) el.style.setProperty('--seal', colorOf(tube[0]));
    el.setAttribute('aria-label', describe(i));
  }

  function renderAll() {
    tubeEls.forEach((_, i) => renderTube(i));
  }

  function updateHud() {
    const h = game.helps;
    const ready = !!game.puzzle && !game.done;
    $('moveCount').textContent = String(game.history.length);
    const undoBadge = $('undoBadge');
    undoBadge.hidden = h.undos === Infinity;
    undoBadge.textContent = h.undos === Infinity ? '' : String(h.undos);
    $('undoBtn').disabled = !ready || !game.history.length || h.undos <= 0;
    $('restartBtn').disabled = !game.puzzle;
    $('hintBadge').textContent = String(h.hints);
    $('hintBtn').disabled = !ready || h.hints <= 0;
    $('tubeBadge').textContent = String(h.extraTubes);
    $('tubeBtn').disabled = !ready || h.extraTubes <= 0;
  }

  // ---------- Tapping and pouring ----------

  function select(i) {
    game.selected = i;
    tubeEls[i].classList.add('lifted');
  }

  function deselect() {
    if (game.selected >= 0 && tubeEls[game.selected]) tubeEls[game.selected].classList.remove('lifted');
    game.selected = -1;
  }

  function nudge(i, message) {
    const el = tubeEls[i];
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 400);
    say(message);
    Sound.oops();
  }

  function onTube(i) {
    if (game.busy || game.done || !game.puzzle) return;
    const sel = game.selected;
    if (sel < 0) {
      const t = game.tubes[i];
      if (!t.length) return nudge(i, 'That tube is empty. Pick one with liquid in it!');
      if (Core.isSealed(t, game.cap)) return nudge(i, 'That tube is already finished!');
      select(i);
      Sound.lift();
      return;
    }
    if (sel === i) {
      deselect();
      Sound.tap();
      return;
    }
    const problem = Core.pourProblem(game.tubes, game.cap, sel, i);
    if (problem) {
      deselect();
      if (problem === 'mismatch') return nudge(i, 'Colors must match! Pour onto the same color or into an empty tube.');
      if (problem === 'sealed') return nudge(i, 'That tube is already finished!');
      return nudge(i, 'That tube is full!');
    }
    pourInto(sel, i);
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function pourInto(f, t) {
    game.busy = true;
    const token = game.loadToken;
    clearHint();
    clearStuck();
    const color = game.tubes[f][game.tubes[f].length - 1];
    const dstBefore = game.tubes[t].length;
    game.history.push({ tubes: Core.cloneTubes(game.tubes) });
    const k = Core.pour(game.tubes, game.cap, f, t);
    game.selected = -1;
    updateHud();
    Sound.pour(k, game.tubes[t].length / game.cap);
    try {
      await animatePour(f, t, k, color, dstBefore);
    } catch (e) {
      /* an interrupted animation only skips the show */
    }
    // The player left for another level while the pour was playing.
    if (token !== game.loadToken) return;
    tubeEls[f].classList.remove('lifted');
    normalizeHidden();
    renderTube(f);
    renderTube(t);
    if (Core.isSealed(game.tubes[t], game.cap)) celebrateSeal(t);
    game.busy = false;
    if (needsLayout) {
      needsLayout = false;
      layout();
    }
    updateHud();
    afterMove();
  }

  function animatePour(f, t, k, color, dstBefore) {
    if (reduceMotion || !positions[f] || !positions[t]) return Promise.resolve();
    const el = tubeEls[f];
    const src = positions[f];
    const dst = positions[t];
    const w = src.w;
    const dir = src.x < dst.x ? 1 : -1;
    const angle = dir * 74;
    // The tube turns around the middle of its mouth, so put that point just
    // above the target's opening.
    const mouthX = dst.x + dst.w / 2 - dir * w * 0.12;
    const mouthY = dst.y - w * 0.55;
    const dx = mouthX - (src.x + w / 2);
    const dy = mouthY - src.y;
    const from = 'translate(0px, ' + -w * 0.36 + 'px) rotate(0deg)';
    const to = 'translate(' + dx + 'px, ' + dy + 'px) rotate(' + angle + 'deg)';

    // While the tube tips, its liquid slides toward the mouth and stays
    // there as it drains, then slides back down when the tube rights itself.
    const liquid = el.querySelector('.liquid');
    const inner = src.h - w * 0.08 - 6;
    const room = Math.max(0, inner - game.history[game.history.length - 1].tubes[f].length * unit - w * 0.06);
    const slid = 'translateY(' + -room + 'px)';
    const drained = 'translateY(' + -(room + k * unit) + 'px)';
    const ease = { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' };

    el.classList.add('pouring');
    const swing = el.animate([{ transform: from }, { transform: to }], ease);
    const slide = liquid.animate([{ transform: 'none' }, { transform: slid }], ease);
    return swing.finished
      .then(() => {
        const stream = document.createElement('div');
        stream.className = 'stream';
        const sw = Math.max(5, w * 0.17);
        const surface = dst.y + dst.h - 3 - dstBefore * unit;
        stream.style.left = mouthX - sw / 2 + 'px';
        stream.style.top = mouthY + 'px';
        stream.style.width = sw + 'px';
        stream.style.height = Math.max(10, surface - mouthY) + 'px';
        stream.style.background = colorOf(color);
        board.appendChild(stream);
        stream.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 110, fill: 'forwards' });
        moveLiquid(f, t, k, color, 420);
        liquid.animate([{ transform: slid }, { transform: drained }], { duration: 420, easing: 'linear', fill: 'forwards' });
        slide.cancel();
        return wait(470).then(() => stream);
      })
      .then((stream) => {
        stream
          .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' })
          .finished.then(() => stream.remove(), () => stream.remove());
        const back = el.animate([{ transform: to }, { transform: 'translate(0px, 0px) rotate(0deg)' }], {
          duration: 260,
          easing: 'cubic-bezier(.4,0,.2,1)',
        });
        const settle = liquid.animate([{ transform: drained }, { transform: 'none' }], {
          duration: 260,
          easing: 'cubic-bezier(.5,0,.8,.6)',
        });
        swing.cancel();
        liquid.getAnimations().forEach((a) => a !== settle && a.cancel());
        return back.finished;
      })
      .then(() => {
        el.classList.remove('lifted');
        el.classList.remove('pouring');
      });
  }

  // Shrinks the source's top section and grows the target's while the
  // stream runs. The model already moved; this is only the picture.
  function moveLiquid(f, t, k, color, duration) {
    const opts = { duration, easing: 'linear', fill: 'forwards' };
    const srcTop = tubeEls[f].querySelector('.liquid').lastElementChild;
    if (srcTop) {
      const n = Number(srcTop.style.getPropertyValue('--n')) || k;
      srcTop.animate([{ height: n * unit + 'px' }, { height: Math.max(0, n - k) * unit + 'px' }], opts);
    }
    const dstLiquid = tubeEls[t].querySelector('.liquid');
    let dstTop = dstLiquid.lastElementChild;
    if (dstTop && dstTop.dataset.color === String(color)) {
      const m = Number(dstTop.style.getPropertyValue('--n')) || 0;
      dstTop.animate([{ height: m * unit + 'px' }, { height: (m + k) * unit + 'px' }], opts);
    } else {
      if (dstTop) dstTop.classList.remove('top');
      dstLiquid.insertAdjacentHTML('beforeend', segHtml({ color, n: k, hidden: false }, true));
      dstTop = dstLiquid.lastElementChild;
      dstTop.animate([{ height: '0px' }, { height: k * unit + 'px' }], opts);
    }
  }

  function celebrateSeal(i) {
    const el = tubeEls[i];
    el.classList.add('fresh');
    setTimeout(() => el.classList.remove('fresh'), 700);
    Sound.seal();
    if (!Core.isSolved(game.tubes, game.cap)) say(pickFrom(SEALS));
    if (reduceMotion) return;
    const p = positions[i];
    const color = colorOf(game.tubes[i][0]);
    for (let s = 0; s < 10; s++) {
      const spark = document.createElement('span');
      spark.className = 'spark';
      const angle = (Math.PI * 2 * s) / 10 + Math.random() * 0.4;
      const dist = p.w * (0.7 + Math.random() * 0.6);
      spark.style.left = p.x + p.w / 2 + 'px';
      spark.style.top = p.y + p.w * 0.05 + 'px';
      spark.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      spark.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      spark.style.setProperty('--seal', s % 2 ? color : '#ffd23f');
      board.appendChild(spark);
      setTimeout(() => spark.remove(), 750);
    }
  }

  function afterMove() {
    if (Core.isSolved(game.tubes, game.cap)) {
      win();
      return;
    }
    if (!Core.hasUsefulMove(game.tubes, game.cap)) {
      showStuck('Oops! No more pours. Try Undo or Restart.');
      return;
    }
    // Ask the solver quietly whether the mix can still be finished.
    const token = ++game.checkToken;
    job('solve', { tubes: Core.encode(game.tubes), cap: game.cap, maxNodes: 25000 })
      .then((r) => {
        if (token !== game.checkToken || game.done) return;
        if (r.status === 'unsolvable') showStuck("Uh-oh, this mix can't be finished now. Undo a few pours!");
      })
      .catch(() => {});
    if (game.mode === 'level' && game.level === 1) autoHint();
  }

  // ---------- Tools ----------

  function undo() {
    if (game.busy || game.done || !game.history.length || game.helps.undos <= 0) return;
    deselect();
    clearHint();
    clearStuck();
    game.tubes = game.history.pop().tubes;
    if (game.helps.undos !== Infinity) game.helps.undos--;
    game.checkToken++;
    normalizeHidden();
    renderAll();
    updateHud();
    Sound.whoosh();
    say(game.helps.undos === Infinity ? 'Undone!' : game.helps.undos + ' undos left.');
    if (game.mode === 'level' && game.level === 1) autoHint();
  }

  function restart() {
    if (game.busy || !game.puzzle) return;
    $('win').hidden = true;
    resetBoard();
    Sound.whoosh();
    say('Fresh start!');
    if (game.mode === 'level' && game.level === 1) autoHint();
  }

  function clearHint() {
    if (game.hint) {
      game.hint.forEach((i) => tubeEls[i] && tubeEls[i].classList.remove('hint-from', 'hint-to'));
    }
    game.hint = null;
  }

  function showHint(move) {
    if (!tubeEls[move[0]] || !tubeEls[move[1]]) return;
    clearHint();
    void tubeEls[move[1]].offsetWidth; // restart the arrow's bounce
    game.hint = move;
    tubeEls[move[0]].classList.add('hint-from');
    tubeEls[move[1]].classList.add('hint-to');
  }

  async function hint() {
    if (game.busy || game.done || game.hintPending) return;
    deselect();
    // Any pour, undo, restart, or extra tube clears the hint, so one still
    // showing is still right. Asking again repeats it for free.
    if (game.hint) {
      showHint(game.hint);
      Sound.hint();
      say('Still my best idea: pour the glowing tube into the one with the arrow!');
      return;
    }
    if (game.helps.hints <= 0) return;
    game.hintPending = true;
    say('Let me think…');
    const token = game.checkToken;
    let r;
    try {
      r = await job('solve', { tubes: Core.encode(game.tubes), cap: game.cap, maxNodes: 80000 });
    } finally {
      game.hintPending = false;
    }
    if (token !== game.checkToken || game.done || game.busy) return;
    if (r.status === 'solved' && r.moves.length) {
      game.helps.hints--;
      game.helped = true;
      showHint(r.moves[0]);
      Sound.hint();
      say('Pour the glowing tube into the one with the arrow!');
    } else if (r.status === 'unsolvable') {
      showStuck("Even I can't finish this mix. Try Undo!");
    } else {
      say('This one is tricky even for me. Try a few pours!');
    }
    updateHud();
  }

  // The first level points at each pour for free.
  function autoHint() {
    const token = game.checkToken;
    job('solve', { tubes: Core.encode(game.tubes), cap: game.cap, maxNodes: 5000 })
      .then((r) => {
        if (token !== game.checkToken || game.done || game.busy) return;
        if (r.status === 'solved' && r.moves.length) showHint(r.moves[0]);
      })
      .catch(() => {});
  }

  function addTube() {
    if (game.busy || game.done || game.helps.extraTubes <= 0) return;
    deselect();
    clearHint();
    clearStuck();
    game.helps.extraTubes--;
    game.helped = true;
    game.checkToken++;
    game.tubes.push([]);
    game.hidden.push(0);
    game.history.forEach((h) => h.tubes.push([]));
    const el = makeTube(game.tubes.length - 1);
    board.appendChild(el);
    tubeEls.push(el);
    layout();
    renderTube(tubeEls.length - 1);
    if (!reduceMotion) {
      el.animate([{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 320,
        easing: 'cubic-bezier(.3,1.5,.6,1)',
      });
    }
    Sound.whoosh();
    say('Here is an extra empty tube!');
    updateHud();
  }

  function showStuck(text) {
    say(text);
    $('say').classList.add('alert');
    ['undoBtn', 'restartBtn', 'tubeBtn'].forEach((id) => $(id).classList.add('pulse'));
    Sound.oops();
  }

  function clearStuck() {
    $('say').classList.remove('alert');
    ['undoBtn', 'restartBtn', 'tubeBtn'].forEach((id) => $(id).classList.remove('pulse'));
  }

  // ---------- Winning ----------

  function win() {
    game.done = true;
    clearHint();
    clearStuck();
    const moves = game.history.length;
    const par = game.puzzle.par;
    let stars = moves <= par ? 3 : moves <= Math.ceil(par * 1.4) ? 2 : 1;
    if (game.helped) stars = Math.min(stars, 2);
    if (game.mode === 'level') {
      const n = game.level;
      saved.stars[n] = Math.max(saved.stars[n] || 0, stars);
      saved.best[n] = saved.best[n] ? Math.min(saved.best[n], moves) : moves;
      saved.unlocked = Math.max(saved.unlocked, n + 1);
      save();
    }
    updateHud();
    say('Experiment complete! Amazing work!');
    const token = game.loadToken;
    setTimeout(() => {
      if (!game.done || token !== game.loadToken || screen !== 'play') return;
      Sound.win();
      confetti();
      showWin(stars, moves, par);
    }, reduceMotion ? 100 : 650);
  }

  function showWin(stars, moves, par) {
    const isLevel = game.mode === 'level';
    $('winLab').textContent = isLevel ? Core.labOf(game.level).name : 'Your mix';
    $('winTitle').textContent = isLevel ? 'Experiment\u00a0' + game.level + ' complete!' : 'Mix complete!';
    const starEls = $('winStars').querySelectorAll('i');
    starEls.forEach((s, i) => s.classList.toggle('on', i < stars));
    $('winStars').setAttribute('aria-label', stars + (stars === 1 ? ' star' : ' stars'));
    $('winStats').textContent = moves + (moves === 1 ? ' move' : ' moves');
    let note;
    if (moves < par) note = "You beat the robot's record of " + par + ' moves!';
    else if (moves === par) note = "You matched the robot's record!";
    else note = "Robot's record: " + par + ' moves. Can you match it?';
    if (game.helped && stars === 2) note += ' Finish without hints or an extra tube for 3 stars.';
    $('winNote').textContent = note;
    const code = $('winCode');
    code.hidden = isLevel;
    if (!isLevel) code.innerHTML = 'Lab code <b>' + customCode(game.custom) + '</b> · share it so friends can try this mix';
    $('nextBtn').querySelector('.big-label').textContent = isLevel ? 'Next experiment' : 'Mix another';
    $('win').hidden = false;
    $('nextBtn').focus({ preventScroll: true });
  }

  function confetti() {
    if (reduceMotion) return;
    const canvas = $('confetti');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bits = Array.from({ length: 140 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.45,
      vx: (Math.random() - 0.5) * 12,
      vy: -6 - Math.random() * 10,
      size: 6 + Math.random() * 7,
      spin: Math.random() * 6,
      vs: (Math.random() - 0.5) * 0.4,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      round: Math.random() < 0.35,
    }));
    const start = performance.now();
    function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      bits.forEach((b) => {
        b.vy += 0.32;
        b.vx *= 0.99;
        b.x += b.vx;
        b.y += b.vy;
        b.spin += b.vs;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t / 2800);
        ctx.translate(b.x, b.y);
        ctx.rotate(b.spin);
        ctx.fillStyle = b.color;
        if (b.round) {
          ctx.beginPath();
          ctx.arc(0, 0, b.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        ctx.restore();
      });
      if (t < 2800) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  // ---------- Settings ----------

  function setSound(on) {
    saved.sound = on;
    save();
    Sound.setEnabled(on);
    const btn = $('soundBtn');
    btn.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
    btn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    btn.setAttribute('aria-pressed', String(on));
    $('soundToggle').checked = on;
  }

  function setShapes(on) {
    saved.shapes = on;
    save();
    $('shapesToggle').checked = on;
    if (game.puzzle) renderAll();
  }

  // ---------- Wiring ----------

  function wire() {
    document.querySelectorAll('.icon-btn.back').forEach((b) => (b.innerHTML = ICONS.back));
    $('homeBtn').innerHTML = ICONS.menu;
    document.querySelector('#undoBtn .tool-icon').innerHTML = ICONS.undo;
    document.querySelector('#restartBtn .tool-icon').innerHTML = ICONS.restart;
    document.querySelector('#hintBtn .tool-icon').innerHTML = ICONS.hint;
    document.querySelector('#tubeBtn .tool-icon').innerHTML = ICONS.tube;

    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
    $('playBtn').addEventListener('click', () => startLevel(saved.unlocked));
    $('levelsBtn').addEventListener('click', () => show('levels'));
    $('customBtn').addEventListener('click', () => show('custom'));
    $('homeBtn').addEventListener('click', () => {
      game.loadToken++;
      show('home');
    });
    $('soundBtn').addEventListener('click', () => setSound(!saved.sound));
    $('soundToggle').addEventListener('change', (e) => setSound(e.target.checked));
    $('shapesToggle').addEventListener('change', (e) => setShapes(e.target.checked));

    $('undoBtn').addEventListener('click', undo);
    $('restartBtn').addEventListener('click', restart);
    $('hintBtn').addEventListener('click', hint);
    $('tubeBtn').addEventListener('click', addTube);

    $('nextBtn').addEventListener('click', () => {
      $('win').hidden = true;
      if (game.mode === 'level') startLevel(game.level + 1);
      else startCustom(Object.assign({}, game.custom, { seed: 1000 + Math.floor(Math.random() * 9000) }));
    });
    $('replayBtn').addEventListener('click', restart);

    document.querySelectorAll('.stepper').forEach((row) => {
      row.querySelectorAll('.step-btn').forEach((btn) =>
        btn.addEventListener('click', () => {
          const key = row.dataset.key;
          saved.custom[key] += Number(btn.dataset.step);
          const { clamped } = clampCustom();
          save();
          renderCustom(clamped);
          Sound.tap();
        })
      );
    });
    document.querySelectorAll('input[name="difficulty"]').forEach((r) =>
      r.addEventListener('change', () => {
        saved.custom.difficulty = r.value;
        save();
      })
    );
    $('mysteryToggle').addEventListener('change', (e) => {
      saved.custom.mystery = e.target.checked;
      save();
    });
    $('mixBtn').addEventListener('click', () => startCustom(newCustomSpec()));
    $('codeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const spec = parseCode($('codeInput').value);
      const err = $('codeError');
      if (!spec) {
        err.hidden = false;
        err.textContent = 'That code does not look right. It should look like 064220-1234.';
        return;
      }
      err.hidden = true;
      startCustom(spec);
    });

    document.addEventListener('keydown', (e) => {
      if (screen !== 'play' || e.metaKey || e.altKey) return;
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if ((e.key === 'z' && e.ctrlKey) || e.key === 'u') {
        e.preventDefault();
        undo();
      } else if (e.key === 'h') hint();
      else if (e.key === 'Escape') deselect();
      else if (/^[0-9]$/.test(e.key) && !e.ctrlKey) {
        const i = e.key === '0' ? 9 : Number(e.key) - 1;
        if (i < tubeEls.length) onTube(i);
      }
    });

    let pending = false;
    const relayout = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        if (screen === 'play' && !game.busy) layout();
        else if (game.busy) needsLayout = true;
      });
    };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe(board);
    else window.addEventListener('resize', relayout);
  }

  // Lets an open copy of the page pick up where it was after an update.
  function snapshot() {
    if (screen !== 'play' || !game.puzzle || game.done) return { screen };
    return {
      screen,
      game: {
        mode: game.mode,
        level: game.level,
        custom: game.custom,
        puzzle: game.puzzle,
        tubes: game.tubes,
        hidden: game.hidden,
        history: game.history,
        helps: game.helps,
        helped: game.helped,
      },
    };
  }

  function start(data) {
    wire();
    setSound(saved.sound);
    setShapes(saved.shapes);
    startWorker();
    getLevel(saved.unlocked).catch(() => {});
    const g = data && data.game;
    if (g && g.puzzle) {
      Object.assign(game, { mode: g.mode, level: g.level, custom: g.custom });
      setLab(g.mode === 'level' ? Core.labOf(g.level).index : 5);
      show('play');
      $('labName').textContent = g.mode === 'level' ? Core.labOf(g.level).name : 'Your mix';
      $('levelTitle').textContent = g.mode === 'level' ? 'Experiment ' + g.level : 'Lab code ' + customCode(g.custom);
      setPuzzle(g.puzzle);
      Object.assign(game, {
        tubes: g.tubes,
        hidden: g.hidden,
        history: g.history,
        helps: Object.assign({}, g.helps, { undos: g.helps.undos == null ? Infinity : g.helps.undos }),
        helped: g.helped,
      });
      buildBoard();
      updateHud();
    } else if (data && data.screen && data.screen !== 'play') {
      show(data.screen);
    } else {
      show('home');
    }
  }

  const hot = window.claude && window.claude.hot;
  try {
    if (hot && hot.snapshot) hot.snapshot(snapshot);
  } catch (e) {
    /* not inside a viewer that supports it */
  }
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
