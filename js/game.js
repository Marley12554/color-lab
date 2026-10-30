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
  // What the robot says when a mode shows up, rarest first.
  const MODE_INTROS = [
    ['labels', 'Labeled tubes! Each one only takes its own color.'],
    ['minis', 'Mini tubes! They hold just a little and must end up empty.'],
    ['giant', 'Giant tubes! One color has twice as many layers. Fill a giant tube all the way with it!'],
    ['mystery', 'Mystery layers! Gray layers show their color when you uncover them.'],
  ];

  function modeIntro(modes) {
    const hit = MODE_INTROS.find(([key]) => modes && modes[key]);
    return hit ? hit[1] : null;
  }

  function modeNames(modes) {
    const names = [];
    if (modes.giant) names.push(modes.giant === 2 ? '2 Giant Tubes' : 'Giant Tube');
    if (modes.minis) names.push('Mini Tubes');
    if (modes.labels) names.push('Labeled Tubes');
    if (modes.mystery) names.push('Mystery Layers');
    return names;
  }
  const CHEERS = ["Let's sort these samples!", 'Ready, scientist?', 'Time for some science!', 'Sort it, pour it, seal it!', 'You can do it!'];
  const SEALS = ['Tube complete!', 'Sealed it!', 'Perfect pour!', 'Super sorting!', 'Nice one!'];
  const DIFFS = ['easy', 'medium', 'hard', 'genius'];
  // Extra moves allowed for 3 stars, as a share of the robot's count.
  const STAR_LEEWAY = 0.125;

  // ---------- Saved progress (this browser only) ----------

  const STORE_KEY = 'color-lab-v1';

  function defaults() {
    return {
      unlocked: 1,
      stars: {},
      best: {},
      sound: true,
      shapes: false,
      custom: { colors: 6, cap: 4, empties: 2, difficulty: 'medium', modes: { giant: 0, minis: false, labels: false, mystery: false } },
    };
  }

  function load() {
    const base = defaults();
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        const custom = Object.assign(base.custom, data.custom);
        // Settings saved before modes: carry over what still exists.
        if (!data.custom || !data.custom.modes) {
          const old = (data.custom && data.custom.shape) || 'classic';
          custom.modes = {
            giant: old === 'beaker' ? 1 : old === 'boosters' ? 2 : 0,
            minis: old === 'minis',
            labels: false,
            mystery: !!(data.custom && data.custom.mystery),
          };
        }
        delete custom.shape;
        delete custom.mystery;
        return Object.assign(base, data, { custom });
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
          else if (type === 'check') {
            resolve(Core.checkMix(payload.tubes, payload.cap, payload.history, { extraTube: payload.extraTube }));
          } else resolve(Core.solve(payload.tubes, payload.cap, { weight: 2, maxNodes: payload.maxNodes || 60000 }));
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
    const run = saved.run;
    // A run of the level Play would start is resumed by Play itself.
    const runIsNext = run && run.mode === 'level' && run.level === n;
    $('playSub').textContent = 'Experiment ' + n + ' · ' + lab.name + (runIsNext ? ' · resume' : '');
    $('resumeBtn').hidden = !run || runIsNext;
    $('playBtn').classList.toggle('primary', !run || runIsNext);
    if (run && !runIsNext) {
      const where = run.mode === 'level' ? 'Experiment ' + run.level : 'Your mix';
      $('resumeSub').textContent = where + ' · ' + run.moves + (run.moves === 1 ? ' move' : ' moves');
    }
    $('soundToggle').checked = saved.sound;
    $('shapesToggle').checked = saved.shapes;
  }

  // Every level is open. The map shows the story labs, the endless labs up
  // to one past the player's progress, and more on request.
  let extraLabs = 0;

  function renderLevels() {
    const list = $('labList');
    list.innerHTML = '';
    const lastLab = Math.max(Core.LAB_COUNT, Core.labOf(saved.unlocked).index + 2) - 1 + extraLabs;
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
        const spec = Core.levelSpec(n);
        const special = !!spec.modes && Core.hasBoardModes(spec.modes);
        btn.className = 'level-btn' + (n === saved.unlocked ? ' current' : '') + (special ? ' special' : '');
        const stars = saved.stars[n] || 0;
        btn.innerHTML =
          '<span>' + n + '</span><span class="mini-stars">' +
          [1, 2, 3].map((s) => '<i class="' + (s <= stars ? 'on' : '') + '"></i>').join('') +
          '</span>';
        btn.setAttribute(
          'aria-label',
          'Experiment ' + n + (special ? ', ' + modeNames(spec.modes).join(' and ') : '') + ', ' + stars + (stars === 1 ? ' star' : ' stars')
        );
        btn.addEventListener('click', () => startLevel(n));
        grid.appendChild(btn);
      }
      list.appendChild(section);
    }
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'small-btn alt more-labs';
    more.textContent = 'Show more labs';
    more.addEventListener('click', () => {
      extraLabs += 3;
      const y = $('levels').scrollTop;
      renderLevels();
      $('levels').scrollTop = y;
    });
    list.appendChild(more);
  }

  function scrollToCurrent() {
    const current = $('labList').querySelector('.current');
    if (current) current.scrollIntoView({ block: 'center' });
  }

  // ---------- Custom mixes ----------

  function clampCustom() {
    const c = saved.custom;
    c.modes = Core.normalizeModes(c.modes);
    c.cap = Math.min(6, Math.max(3, c.cap));
    const minEmpties = Core.minEmptiesFor(c.modes);
    const emptiesRaised = c.empties < minEmpties;
    c.empties = Math.min(3, Math.max(minEmpties, c.empties));
    const max = Core.maxColorsFor(c.cap, c.empties, c.modes);
    const min = Core.minColorsFor(c.modes);
    const clamped = c.colors > max || c.colors < min || emptiesRaised;
    c.colors = Math.min(max, Math.max(min, c.colors));
    return { max, min, minEmpties, clamped };
  }

  function renderCustom(clampedNow) {
    const c = saved.custom;
    const { max, min, minEmpties } = clampCustom();
    const m = c.modes;
    const plain = !Core.hasBoardModes(m);
    $('colorsOut').textContent = c.colors;
    $('capOut').textContent = c.cap;
    $('emptiesOut').textContent = c.empties;
    const limits = { colors: [min, max], cap: [3, 6], empties: [minEmpties, 3] };
    document.querySelectorAll('.stepper').forEach((row) => {
      const key = row.dataset.key;
      row.querySelector('[data-step="-1"]').disabled = c[key] <= limits[key][0];
      row.querySelector('[data-step="1"]').disabled = c[key] >= limits[key][1];
    });
    $('modeGiant').checked = m.giant > 0;
    document.querySelectorAll('input[name="giants"]').forEach((r) => {
      r.disabled = !m.giant;
      r.checked = Number(r.value) === (m.giant || 1);
    });
    $('modeMinis').checked = m.minis;
    $('modeLabels').checked = m.labels;
    const note = $('sizeNote');
    // Explain a limit only when it is the thing stopping a button.
    const pairCap = m.minis && m.labels && c.colors >= max;
    const giantFloor = m.giant > 0 && c.empties === minEmpties;
    note.hidden = !((plain && c.empties === 1) || pairCap || giantFloor || clampedNow);
    if (giantFloor) {
      note.textContent =
        (m.giant === 2 ? '2 Giant Tubes need' : 'A Giant Tube needs') + ' at least ' + minEmpties +
        ' empty tubes, to dig the mixed colors out of ' + (m.giant === 2 ? 'them.' : 'it.');
    } else if (pairCap) note.textContent = 'With Mini Tubes and Labeled Tubes both on, ' + max + ' colors is the most.';
    else if (!plain && clampedNow) note.textContent = 'These modes need ' + min + ' to ' + max + ' colors.';
    else if (plain && c.empties === 1) {
      note.textContent = 'One empty tube means more dead ends. Up to ' + max + ' colors fit in tubes this size.';
    }
    else note.textContent = 'Up to ' + max + ' colors.';
    document.querySelectorAll('input[name="difficulty"]').forEach((r) => {
      r.checked = r.value === c.difficulty;
    });
    $('mysteryToggle').checked = m.mystery;
  }

  /*
   * Lab codes: two digits of colors, then height, empty tubes, challenge,
   * mystery, giant tubes (0-2), and mini tubes + 2 x labeled tubes, then the
   * seed, like 06422000-1234. Older codes are six digits (classic) or seven
   * (the last digit was the old board shape; only 0, the classic board,
   * still exists).
   */
  function customCode(spec) {
    const m = Core.normalizeModes(spec.modes);
    return (
      String(spec.colors).padStart(2, '0') + spec.cap + spec.empties + DIFFS.indexOf(spec.difficulty) +
      (m.mystery ? 1 : 0) + m.giant + ((m.minis ? 1 : 0) + (m.labels ? 2 : 0)) + '-' + spec.seed
    );
  }

  function parseCode(text) {
    const match = /^\s*(\d{6,8})\s*-?\s*(\d{1,6})\s*$/.exec(text || '');
    if (!match) return null;
    const d = match[1];
    if (d.length === 7 && d[6] !== '0') return { outdated: true };
    const extra = d.length === 8 ? +d[7] : 0;
    const spec = {
      colors: +d.slice(0, 2),
      cap: +d[2],
      empties: +d[3],
      difficulty: DIFFS[+d[4]],
      modes: Core.normalizeModes({
        mystery: d[5] === '1',
        giant: d.length === 8 ? +d[6] : 0,
        minis: (extra & 1) === 1,
        labels: (extra & 2) === 2,
      }),
      seed: +match[2],
    };
    if (!spec.difficulty || !/[01]/.test(d[5]) || (d.length === 8 && (+d[6] > 2 || extra > 3))) return null;
    if (spec.cap < 3 || spec.cap > 6 || spec.empties < Core.minEmptiesFor(spec.modes) || spec.empties > 3) return null;
    if (spec.colors < Core.minColorsFor(spec.modes) || spec.colors > Core.maxColorsFor(spec.cap, spec.empties, spec.modes)) return null;
    return spec;
  }

  function newCustomSpec() {
    clampCustom();
    return Object.assign({}, saved.custom, { modes: Object.assign({}, saved.custom.modes), seed: 1000 + Math.floor(Math.random() * 9000) });
  }

  // ---------- The game ----------

  const board = $('board');
  const game = {
    mode: 'level',
    level: 1,
    custom: null,
    puzzle: null,
    // Each tube's height and the layers that make a finished color.
    board: { caps: [], units: 4 },
    tubes: [],
    hidden: [],
    history: [],
    helps: Object.assign({}, Core.HELPS),
    helped: false,
    // Every pour this try, including ones later undone. Restart zeroes it.
    moves: 0,
    undone: 0,
    stuck: false,
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
    if (saved.run && saved.run.mode === 'level' && saved.run.level === n) {
      resumeRun(saved.run);
      return;
    }
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
        modes: spec.modes,
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
    puzzle.mystery = Core.normalizeModes(spec.modes).mystery;
    setPuzzle(puzzle);
  }

  function setPuzzle(puzzle) {
    $('loading').hidden = true;
    game.puzzle = puzzle;
    game.palette = puzzle.palette;
    resetBoard();
    let line;
    if (game.mode === 'level' && INTROS[game.level]) line = INTROS[game.level];
    else if (modeIntro(puzzle.modes)) line = modeIntro(puzzle.modes);
    else line = pickFrom(CHEERS);
    say(line);
    if (game.mode === 'level' && game.level === 1) autoHint();
    saveRun();
  }

  function resetBoard() {
    const p = game.puzzle;
    const units = p.units || p.cap;
    game.board = {
      caps: (p.caps || p.tubes.map(() => units)).slice(),
      labels: p.tubes.map((_, i) => (p.labels && p.labels[i] != null ? p.labels[i] : -1)),
      big: (p.big || []).slice(),
      units,
    };
    game.tubes = Core.cloneTubes(p.tubes);
    game.hidden = game.tubes.map((t) => (p.mystery ? t.length - Core.topRun(t).count : 0));
    game.history = [];
    game.selected = -1;
    game.done = false;
    game.helped = false;
    game.moves = 0;
    game.undone = 0;
    game.busy = false;
    game.checkToken++;
    game.helps = Object.assign({}, Core.HELPS);
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
    el.innerHTML =
      '<span class="glass"><span class="liquid"></span><span class="tag"><i></i></span></span><span class="lip"></span><span class="stopper"></span>';
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
    // Ready the shape pictures the pour draws, so the first pour doesn't wait on them.
    if (saved.shapes) new Set(game.tubes.flat()).forEach(shapeImage);
    layout();
    renderAll();
  }

  // Lays the tubes out in rows, each tube standing on its row's rack.
  // Giant tubes get columns of their own that span every row.
  function layout() {
    const n = tubeEls.length;
    if (!n) return;
    const caps = game.board.caps;
    const bw = board.clientWidth;
    const bh = board.clientHeight;
    if (!bw || !bh) return;

    // Giant tubes: in the middle, at either end, or side by side on one
    // side. Older saves used { center: i } or { ends: [i, j] }.
    const feat = (game.puzzle && game.puzzle.featured) || {};
    const list = (v) => (v == null ? [] : [].concat(v)).filter((i) => i < n);
    const leftF = list(feat.left).concat(feat.ends ? list(feat.ends[0]) : []);
    const rightF = list(feat.right).concat(feat.ends ? list(feat.ends[1]) : []);
    const centerF = list(feat.center);
    const center = centerF.length ? centerF[0] : -1;
    const special = new Set(leftF.concat(rightF, centerF));
    const grid = [];
    for (let i = 0; i < n; i++) if (!special.has(i)) grid.push(i);
    const tall = (i) => caps[i] * UNIT + NECK; // in tube widths

    const plan = (rows) => {
      const rowsOf = [];
      for (let r = 0, at = 0; r < rows; r++) {
        const k = Math.ceil((grid.length - at) / (rows - r));
        rowsOf.push(grid.slice(at, (at += k)));
      }
      const rowH = rowsOf.map((row) => Math.max(0, ...row.map(tall)) + LIFT);
      const gridH = rowH.reduce((a, b) => a + b, 0) + (rows - 1) * GAP_Y;
      const featH = Math.max(0, ...Array.from(special, (i) => tall(i) + LIFT));
      const cols = (rowsOf[0] ? rowsOf[0].length : 0) + special.size;
      const byWidth = bw / (cols + GAP_X * (cols - 1));
      const byHeight = bh / Math.max(gridH, featH);
      return { rowsOf, rowH, gridH, blockH: Math.max(gridH, featH), cols, w: Math.min(byWidth, byHeight, MAX_W) };
    };
    let best = plan(1);
    for (let rows = 2; rows <= Math.min(4, grid.length); rows++) {
      const p = plan(rows);
      if (p.w > best.w + 0.5) best = p;
    }

    const w = Math.floor(best.w);
    unit = w * UNIT;
    board.style.setProperty('--w', w + 'px');
    board.style.setProperty('--unit', unit + 'px');
    const step = w * (1 + GAP_X);
    const totalW = best.cols * w + (best.cols - 1) * w * GAP_X;
    const x0 = (bw - totalW) / 2;
    const bottom = Math.max(0, (bh - best.blockH * w) / 2) + best.blockH * w;

    positions = [];
    const place = (i, x, foot) => {
      const h = tall(i) * w;
      positions[i] = { x, y: foot - h, w, h };
      const el = tubeEls[i];
      el.style.left = x + 'px';
      el.style.top = foot - h + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    };

    rackEls.forEach((r) => r.remove());
    rackEls = [];
    const gridCols = best.cols - special.size;
    const gridX0 = x0 + leftF.length * step;
    const centerX = gridX0 + Math.ceil(gridCols / 2) * step;
    let foot = bottom - best.gridH * w;
    best.rowsOf.forEach((row, r) => {
      foot += best.rowH[r] * w + (r ? GAP_Y * w : 0);
      if (center >= 0) {
        // Half the row on each side of the middle column.
        const leftCount = Math.ceil(row.length / 2);
        row.forEach((i, j) => {
          place(i, j < leftCount ? centerX - (leftCount - j) * step : centerX + (j - leftCount + 1) * step, foot);
        });
      } else {
        const gridW = gridCols * w + (gridCols - 1) * w * GAP_X;
        const rowW = row.length * w + (row.length - 1) * w * GAP_X;
        row.forEach((i, j) => place(i, gridX0 + (gridW - rowW) / 2 + j * step, foot));
      }
      const rack = document.createElement('div');
      rack.className = 'rack';
      rack.style.left = x0 - w * 0.35 + 'px';
      rack.style.width = totalW + w * 0.7 + 'px';
      rack.style.top = foot - w * 1.05 + 'px';
      rack.style.height = w * 0.44 + 'px';
      board.insertBefore(rack, board.firstChild);
      rackEls.push(rack);
    });
    if (center >= 0) place(center, centerX, bottom);
    leftF.forEach((i, k) => place(i, x0 + k * step, bottom));
    rightF.forEach((i, k) => place(i, x0 + (best.cols - rightF.length + k) * step, bottom));
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
    const label = game.board.labels ? game.board.labels[i] : -1;
    const name = 'Tube ' + (i + 1) + (label >= 0 ? ', takes only ' + nameOf(label) : '');
    if (!t.length) return name + ', empty';
    if (Core.isSealed(t, game.board)) return name + ', finished, all ' + nameOf(t[0]);
    const names = t.map((c, k) => (k < game.hidden[i] ? 'mystery' : nameOf(c)));
    return name + ', bottom to top: ' + names.join(', ');
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
    const sealed = Core.isSealed(tube, game.board);
    el.classList.toggle('sealed', sealed);
    if (sealed) el.style.setProperty('--seal', colorOf(tube[0]));
    const label = game.board.labels ? game.board.labels[i] : -1;
    el.classList.toggle('labeled', label >= 0);
    if (label >= 0) {
      el.style.setProperty('--label', colorOf(label));
      el.querySelector('.tag i').innerHTML = saved.shapes
        ? '<svg viewBox="0 0 24 24" aria-hidden="true">' + SHAPES[game.palette[label]] + '</svg>'
        : '';
    }
    el.setAttribute('aria-label', describe(i));
  }

  function renderAll() {
    tubeEls.forEach((_, i) => renderTube(i));
  }

  function updateHud() {
    const h = game.helps;
    const ready = !!game.puzzle && !game.done;
    $('moveCount').textContent = String(game.moves);
    $('undoBtn').disabled = !ready || !game.history.length;
    // Nothing to restart until a pour or a help has been used. Undoing back
    // to the start keeps it on, since the move count still needs resetting.
    $('restartBtn').disabled = !game.puzzle || (game.moves === 0 && !game.helped);
    $('hintBadge').textContent = String(h.hints);
    $('hintBtn').disabled = !ready || h.hints <= 0;
    $('tubeBadge').textContent = String(h.extraTubes);
    $('tubeBtn').disabled = !ready || h.extraTubes <= 0;
  }

  // ---------- Tapping and pouring ----------

  function select(i) {
    game.selected = i;
    tubeEls[i].classList.add('lifted');
    syncHint();
    if (game.hint && game.hint[0] === i) say('Now pour it into the tube with the arrow!');
  }

  function deselect() {
    if (game.selected >= 0 && tubeEls[game.selected]) tubeEls[game.selected].classList.remove('lifted');
    game.selected = -1;
    syncHint();
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
    if (game.stuck) {
      const el = tubeEls[i];
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 400);
      showStuck("This mix can't be finished. Tap Undo!");
      return;
    }
    const sel = game.selected;
    if (sel < 0) {
      const t = game.tubes[i];
      if (!t.length) return nudge(i, 'That tube is empty. Pick one with liquid in it!');
      if (Core.isSealed(t, game.board)) return nudge(i, 'That tube is already finished!');
      select(i);
      Sound.lift();
      return;
    }
    if (sel === i) {
      deselect();
      Sound.tap();
      return;
    }
    const problem = Core.pourProblem(game.tubes, game.board, sel, i);
    if (problem) {
      deselect();
      if (problem === 'mismatch') return nudge(i, 'Colors must match! Pour onto the same color or into an empty tube.');
      if (problem === 'sealed') return nudge(i, 'That tube is already finished!');
      if (problem === 'label') return nudge(i, 'That tube only takes ' + nameOf(game.board.labels[i]) + '!');
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
    game.checkToken++;
    clearHint();
    clearStuck();
    const color = game.tubes[f][game.tubes[f].length - 1];
    const dstBefore = game.tubes[t].length;
    game.history.push({ tubes: Core.cloneTubes(game.tubes) });
    const k = Core.pour(game.tubes, game.board, f, t);
    game.moves++;
    // Saved before the animation, so leaving mid-pour keeps the pour.
    normalizeHidden();
    saveRun();
    game.selected = -1;
    updateHud();
    Sound.pour(k, game.tubes[t].length / game.board.caps[t]);
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
    if (Core.isSealed(game.tubes[t], game.board)) celebrateSeal(t);
    game.busy = false;
    if (needsLayout) {
      needsLayout = false;
      layout();
    }
    updateHud();
    afterMove();
    saveRun();
  }

  // ---------- The pour, drawn frame by frame ----------
  //
  // While a tube tips, its liquid is painted on a canvas inside its glass.
  // Every layer keeps its amount and its surface stays level with the
  // ground, so the liquid slides toward the mouth as the tube tips. The tube
  // tips just far enough for the liquid to reach the lip, then keeps tipping
  // as it empties, turning around the lip so the stream stays in one place.
  // The stream falls, lands in the target, and the target fills as the
  // liquid arrives.

  // The inside of a glass: straight sides and a round bottom.
  function glassShape(W, H) {
    const r = W / 2;
    const cy = Math.max(0, H - r);
    const pts = [[0, 0], [W, 0]];
    for (let s = 0; s <= 12; s++) {
      const a = (Math.PI * s) / 12;
      pts.push([r + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  // The part of a shape at depth D or deeper, depth measured along g.
  function clipDeep(poly, gx, gy, D) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = a[0] * gx + a[1] * gy - D;
      const db = b[0] * gx + b[1] * gy - D;
      if (da >= 0) out.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  }

  function areaOf(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }

  function centroidOf(poly) {
    let x = 0;
    let y = 0;
    poly.forEach((p) => {
      x += p[0];
      y += p[1];
    });
    return [x / poly.length, y / poly.length];
  }

  // The surface depth that leaves `amount` of area below it.
  function levelFor(poly, gx, gy, amount) {
    let lo = Infinity;
    let hi = -Infinity;
    poly.forEach((p) => {
      const d = p[0] * gx + p[1] * gy;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    });
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (areaOf(clipDeep(poly, gx, gy, mid)) > amount) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  // Color shape pictures for the canvas, made once per shape.
  const shapeImages = {};
  function shapeImage(color) {
    const s = game.palette[color];
    if (!shapeImages[s]) {
      const img = new Image();
      img.src =
        'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgba(255,255,255,0.82)">' + SHAPES[s] + '</svg>'
        );
      if (img.decode) img.decode().catch(() => {});
      shapeImages[s] = img;
    }
    return shapeImages[s];
  }

  function animatePour(f, t, k, color, dstBefore) {
    if (reduceMotion || !positions[f] || !positions[t]) return Promise.resolve();
    const token = game.loadToken;
    const el = tubeEls[f];
    const src = positions[f];
    const dst = positions[t];
    const w = src.w;
    const dir = src.x < dst.x ? 1 : -1;

    // The source's layers, read from the board before it changes.
    const liquidEl = el.querySelector('.liquid');
    const segs = Array.from(liquidEl.children).map((s) => ({
      n: Number(s.style.getPropertyValue('--n')) || 1,
      color: s.dataset.color === '' ? -1 : Number(s.dataset.color),
      hidden: s.classList.contains('hidden'),
    }));
    const n0 = segs.reduce((sum, s) => sum + s.n, 0);
    const glass = el.querySelector('.glass');
    const W = glass.clientWidth;
    const H = glass.clientHeight;
    const shape = glassShape(W, H);
    const amount = (units) => areaOf(clipDeep(shape, 0, 1, H - units * unit));

    // How much the tube holds before spilling when tipped by `angle`.
    const holds = (angle) => {
      const gx = Math.sin(angle);
      const gy = Math.cos(angle);
      return areaOf(clipDeep(shape, gx, gy, Math.max(0, W * gx)));
    };
    const tiltFor = (units) => {
      const a = amount(units);
      let lo = 0;
      let hi = Math.PI / 2;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (holds(dir * mid) > a) lo = mid;
        else hi = mid;
      }
      return (dir * (lo + hi)) / 2;
    };
    const tiltStart = tiltFor(n0);
    const tiltEnd = tiltFor(n0 - k);

    // The tube turns around the transform origin (its top middle). The
    // stream leaves from the outer edge of the lip, which stays put over
    // the middle of the target while the liquid runs.
    const origin = [w / 2, 0];
    const lip = [w / 2 + dir * w * 0.56, w * 0.1];
    const turn = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
    // Lift the lip high enough that the tipped tube clears the target.
    const outline = [[-0.09 * w, 0], [1.09 * w, 0], [-0.09 * w, 0.17 * w], [1.09 * w, 0.17 * w]];
    for (let s = 0; s <= 16; s++) outline.push([0, (src.h * s) / 16], [w, (src.h * s) / 16]);
    let below = 0;
    [tiltStart, (tiltStart + tiltEnd) / 2, tiltEnd].forEach((a) => {
      outline.forEach((p) => {
        const q = turn([p[0] - lip[0], p[1] - lip[1]], a);
        if (Math.abs(q[0]) < dst.w * 0.62) below = Math.max(below, q[1]);
      });
    });
    const stream = [dst.x + dst.w / 2, dst.y - Math.min(w * 1.5, Math.max(w * 0.45, below + w * 0.18))];
    const shift = (a) => {
      const q = turn([lip[0] - origin[0], lip[1] - origin[1]], a);
      return [stream[0] - src.x - origin[0] - q[0], stream[1] - src.y - origin[1] - q[1]];
    };
    const lifted = [0, -w * 0.36];
    const shiftStart = shift(tiltStart);
    const shiftEnd = shift(tiltEnd);

    const canvas = document.createElement('canvas');
    canvas.className = 'pour-canvas';
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.ceil(W * dpr);
    canvas.height = Math.ceil(H * dpr);
    liquidEl.after(canvas);
    liquidEl.style.visibility = 'hidden';
    const ctx = canvas.getContext('2d');
    const markFont = getComputedStyle(document.body).getPropertyValue('--font-display');
    const shine = ctx.createLinearGradient(0, 0, W, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0.32)');
    shine.addColorStop(0.38, 'rgba(255,255,255,0)');
    shine.addColorStop(0.7, 'rgba(0,0,0,0)');
    shine.addColorStop(1, 'rgba(0,0,0,0.14)');
    // The diagonal stripes on mystery layers.
    const tile = document.createElement('canvas');
    tile.width = tile.height = 20;
    const tc = tile.getContext('2d');
    tc.strokeStyle = 'rgba(255,255,255,0.28)';
    tc.lineWidth = 7;
    [-20, 0, 20].forEach((o) => {
      tc.beginPath();
      tc.moveTo(o, 20);
      tc.lineTo(o + 20, 0);
      tc.stroke();
    });
    const stripes = ctx.createPattern(tile, 'repeat');

    const fillPoly = (poly, style) => {
      if (poly.length < 3) return;
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = style;
      ctx.fill();
    };

    // Paints the source holding `units` of liquid, tipped by `angle`.
    const drawSource = (units, angle) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const gx = Math.sin(angle);
      const gy = Math.cos(angle);
      if (units <= 0.001) return;
      // Layer edges, bottom to top; the top layer is the one draining.
      const edges = [];
      let below = 0;
      segs.forEach((s) => {
        const top = Math.min(below + s.n, units);
        if (top > below) edges.push({ s, from: below, to: top });
        below += s.n;
      });
      const depths = new Map();
      const depth = (u) => {
        if (!depths.has(u)) depths.set(u, levelFor(shape, gx, gy, amount(u)));
        return depths.get(u);
      };
      const surface = depth(units);
      // Each layer paints from its top surface down; the lower ones paint over.
      for (let i = edges.length - 1; i >= 0; i--) {
        const e = edges[i];
        const region = clipDeep(shape, gx, gy, i === edges.length - 1 ? surface : depth(e.to));
        fillPoly(region, e.s.hidden ? '#b8b4d8' : colorOf(e.s.color));
        if (e.s.hidden) fillPoly(region, stripes);
      }
      const all = clipDeep(shape, gx, gy, surface);
      fillPoly(all, shine);
      // The bright line on the surface.
      fillPoly(clipDeep(all, -gx, -gy, -(surface + 4)), 'rgba(255,255,255,0.45)');
      // Shapes and mystery marks, one per whole layer.
      edges.forEach((e) => {
        if (!e.s.hidden && !saved.shapes) return;
        for (let u = e.from; u < e.to - 0.5; u++) {
          const slice = clipDeep(clipDeep(shape, gx, gy, depth(Math.min(u + 1, e.to))), -gx, -gy, -depth(u));
          if (slice.length < 3) continue;
          const c = centroidOf(slice);
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.25)';
          ctx.shadowOffsetY = 1;
          ctx.shadowBlur = 1;
          if (e.s.hidden) {
            ctx.font = '700 ' + w * 0.44 + 'px ' + markFont;
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', c[0], c[1]);
          } else {
            const img = shapeImage(e.s.color);
            const size = Math.min(W * 0.44, unit * 0.7);
            if (img.complete && img.naturalWidth) ctx.drawImage(img, c[0] - size / 2, c[1] - size / 2, size, size);
          }
          ctx.restore();
        }
      });
    };

    // The target's top layer grows as the liquid lands.
    const dstGlass = tubeEls[t].querySelector('.glass');
    const dstLiquid = dstGlass.querySelector('.liquid');
    let dstTop = dstLiquid.lastElementChild;
    let m0 = 0;
    if (dstTop && dstTop.dataset.color === String(color)) m0 = Number(dstTop.style.getPropertyValue('--n')) || 0;
    else {
      if (dstTop) dstTop.classList.remove('top');
      dstLiquid.insertAdjacentHTML('beforeend', segHtml({ color, n: k, hidden: false }, true));
      dstTop = dstLiquid.lastElementChild;
    }
    dstTop.style.height = m0 * unit + 'px';

    // The stream: one piece above the target, and one inside its glass
    // (behind its label and shine) that runs down to the surface.
    const glassTop = dst.y + dstGlass.offsetTop + dstGlass.clientTop;
    const glassLeft = dst.x + dstGlass.offsetLeft + dstGlass.clientLeft;
    const dstH = dstGlass.clientHeight;
    const outside = document.createElement('div');
    const inside = document.createElement('div');
    const splash = document.createElement('div');
    outside.className = 'stream';
    inside.className = 'stream inside';
    splash.className = 'splash';
    [outside, inside, splash].forEach((d) => (d.style.background = colorOf(color)));
    board.appendChild(outside);
    dstGlass.appendChild(inside);
    dstGlass.appendChild(splash);
    const maxWidth = Math.max(5, w * 0.2);
    const showStream = (head, tail, width, landing) => {
      // head and tail are board heights; head is the lower end.
      const x = stream[0] - width / 2;
      const show = (d, top, bottom, left) => {
        d.style.display = bottom > top ? 'block' : 'none';
        d.style.left = left + 'px';
        d.style.top = top + 'px';
        d.style.width = width + 'px';
        d.style.height = Math.max(0, bottom - top) + 'px';
        d.style.borderRadius = width / 2 + 'px';
      };
      show(outside, tail, Math.min(head, dst.y + w * 0.06), x);
      show(inside, Math.max(tail, glassTop) - glassTop, head - glassTop, x - glassLeft);
      splash.style.display = landing ? 'block' : 'none';
      if (landing) {
        const sw = width * 2.4;
        const sh = Math.max(3, width * 0.55);
        splash.style.left = x - glassLeft + width / 2 - sw / 2 + 'px';
        splash.style.top = head - glassTop - sh / 2 + 'px';
        splash.style.width = sw + 'px';
        splash.style.height = sh + 'px';
      }
    };
    showStream(0, 0, 0, false);

    // Timing, in milliseconds.
    const TIP = 300;
    const RUN = Math.min(760, 240 + 85 * k);
    const BACK = 280;
    const surfaceAt = (units) => glassTop + dstH - units * unit;
    const fallTime = Math.max(80, Math.min(170, 50 + (22 * (surfaceAt(m0) - stream[1])) / w));
    const total = TIP + RUN + Math.max(BACK, fallTime);
    const flow = (ms) => easeInOut(clamp01(ms / RUN));
    const fall = (ms) => clamp01(ms / fallTime) ** 2;
    const pose = (sh, a) => 'translate(' + sh[0] + 'px, ' + sh[1] + 'px) rotate(' + a + 'rad)';

    el.classList.add('pouring');
    return new Promise((resolve) => {
      const start = performance.now();
      const finish = () => {
        canvas.remove();
        outside.remove();
        inside.remove();
        splash.remove();
        liquidEl.style.visibility = '';
        el.style.transform = '';
        el.classList.remove('lifted');
        el.classList.remove('pouring');
        resolve();
      };
      const frame = () => {
        if (token !== game.loadToken || !el.isConnected) return finish();
        const ms = performance.now() - start;
        let units = n0;
        let angle = 0;
        let sh = lifted;
        if (ms < TIP) {
          const p = easeInOut(ms / TIP);
          angle = tiltStart * p;
          sh = [lifted[0] + (shiftStart[0] - lifted[0]) * p, lifted[1] + (shiftStart[1] - lifted[1]) * p];
        } else if (ms < TIP + RUN) {
          units = n0 - k * flow(ms - TIP);
          angle = tiltFor(units);
          sh = shift(angle);
        } else {
          units = n0 - k;
          const p = easeInOut(clamp01((ms - TIP - RUN) / BACK));
          angle = tiltEnd * (1 - p);
          sh = [shiftEnd[0] * (1 - p), shiftEnd[1] * (1 - p)];
        }
        el.style.transform = pose(sh, angle);
        drawSource(units, angle);

        // The liquid reaches the target one fall later than it leaves.
        const run = ms - TIP;
        const landed = m0 + k * flow(run - fallTime);
        dstTop.style.height = landed * unit + 'px';
        const surface = surfaceAt(landed);
        if (run <= 0) showStream(0, 0, 0, false);
        else {
          const head = Math.min(surface, stream[1] + (surface - stream[1]) * fall(run));
          const tail = run < RUN ? stream[1] : stream[1] + (surface - stream[1]) * fall(run - RUN);
          const rate = Math.sin(Math.PI * clamp01(run / RUN));
          const width = maxWidth * (run < RUN ? 0.4 + 0.6 * rate : 0.4);
          showStream(head, tail, width, head >= surface - 1 && tail < surface);
        }
        if (ms >= total) {
          // Draw the final state before the pieces come off, so nothing flickers.
          renderTube(f);
          renderTube(t);
          return finish();
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  function celebrateSeal(i) {
    const el = tubeEls[i];
    el.classList.add('fresh');
    setTimeout(() => el.classList.remove('fresh'), 700);
    Sound.seal();
    if (!Core.isSolved(game.tubes, game.board)) say(pickFrom(SEALS));
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
    if (Core.isSolved(game.tubes, game.board)) {
      win();
      return;
    }
    checkStuck(false);
    if (game.mode === 'level' && game.level === 1) autoHint();
  }

  /*
   * Asks the solver quietly whether the mix can still be finished, and grays
   * the board when it can't. 'unsolvable' means every reachable position was
   * tried, so no pour can help. While already gray (after an undo or an extra
   * tube) the board stays gray until the answer comes back.
   */
  function checkStuck(again) {
    const token = ++game.checkToken;
    job('check', {
      tubes: game.tubes,
      cap: game.board,
      history: game.history.slice(-12).map((h) => h.tubes),
      extraTube: game.helps.extraTubes > 0,
    })
      .then((r) => {
        if (token !== game.checkToken || game.done) return;
        if (r.status === 'unsolvable') {
          showStuck(stuckMessage(r, again), r.undos);
        } else if (game.stuck) {
          clearStuck();
          say('Back on track! Keep going.');
        }
      })
      .catch(() => {});
  }

  /*
   * Says what the warning means (the solver tried every way forward and all
   * of them end stuck, even if some pours are still possible) and what fixes
   * it: how many pours to undo, and whether the extra tube would. It never
   * blames a kind of pour (like filling the last empty tube), because the
   * same kind of pour is often the right move on another turn.
   */
  function stuckMessage(r, again) {
    const noPours = !Core.hasUsefulMove(game.tubes, game.board);
    let what;
    if (again) what = 'Still a dead end.';
    else if (noPours) what = 'No pours left!';
    else what = "Dead end! This mix can't be finished.";
    let fix;
    if (r.undos) {
      fix = 'Undo ' + r.undos + (again ? ' more' : '') + (r.undos === 1 ? ' pour.' : ' pours.');
    } else fix = 'Undo a few pours, or restart.';
    if (r.extraTube) fix += ' Or use the extra tube.';
    return what + ' ' + fix;
  }

  // ---------- Tools ----------

  function undo() {
    if (game.busy || game.done || !game.history.length) return;
    deselect();
    clearHint();
    const wasStuck = game.stuck;
    game.tubes = game.history.pop().tubes;
    game.undone++;
    normalizeHidden();
    renderAll();
    updateHud();
    Sound.whoosh();
    if (!wasStuck) say('Undone!');
    checkStuck(wasStuck);
    if (game.mode === 'level' && game.level === 1) autoHint();
    saveRun();
  }

  function restart() {
    if (game.busy || !game.puzzle) return;
    $('win').hidden = true;
    resetBoard();
    Sound.whoosh();
    say('Fresh start!');
    if (game.mode === 'level' && game.level === 1) autoHint();
    saveRun();
  }

  function clearHint() {
    if (game.hint) {
      game.hint.forEach((i) => tubeEls[i] && tubeEls[i].classList.remove('hint-from', 'hint-to'));
    }
    game.hint = null;
    syncHint();
  }

  // Moves the hint arrow to the pour target once the hinted tube is lifted.
  function syncHint() {
    board.classList.toggle('hint-picked', !!game.hint && game.selected === game.hint[0]);
  }

  function showHint(move) {
    if (!tubeEls[move[0]] || !tubeEls[move[1]]) return;
    clearHint();
    void tubeEls[move[1]].offsetWidth; // restart the arrow's bounce
    game.hint = move;
    tubeEls[move[0]].classList.add('hint-from');
    tubeEls[move[1]].classList.add('hint-to');
    syncHint();
  }

  async function hint() {
    if (game.busy || game.done || game.hintPending) return;
    deselect();
    // Any pour, undo, restart, or extra tube clears the hint, so one still
    // showing is still right. Asking again repeats it for free.
    if (game.hint) {
      showHint(game.hint);
      Sound.hint();
      say('Still my best idea: tap the tube with the arrow!');
      return;
    }
    if (game.helps.hints <= 0) return;
    game.hintPending = true;
    say('Let me think…');
    const token = game.checkToken;
    let r;
    try {
      r = await job('solve', { tubes: Core.encode(game.tubes), cap: game.board, maxNodes: 80000 });
    } finally {
      game.hintPending = false;
    }
    if (token !== game.checkToken || game.done || game.busy) return;
    if (r.status === 'solved' && r.moves.length) {
      game.helps.hints--;
      game.helped = true;
      saveRun();
      showHint(r.moves[0]);
      Sound.hint();
      say('Tap the tube with the arrow!');
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
    job('solve', { tubes: Core.encode(game.tubes), cap: game.board, maxNodes: 5000 })
      .then((r) => {
        if (token !== game.checkToken || game.done || game.busy) return;
        if (r.status === 'solved' && r.moves.length) showHint(r.moves[0]);
      })
      .catch(() => {});
  }

  function addTube() {
    if (game.busy || game.done || game.helps.extraTubes <= 0) return;
    deselect();
    // A hint already paid for is worked out again for the new board, free.
    const hadHint = !!game.hint;
    clearHint();
    const wasStuck = game.stuck;
    game.helps.extraTubes--;
    game.helped = true;
    game.tubes.push([]);
    game.hidden.push(0);
    game.board.caps.push(game.board.units);
    game.board.labels.push(-1);
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
    say(hadHint ? 'Here is an extra empty tube! I updated your hint.' : 'Here is an extra empty tube!');
    updateHud();
    checkStuck(wasStuck);
    saveRun();
    if (hadHint) {
      const token = game.checkToken;
      job('solve', { tubes: Core.encode(game.tubes), cap: game.board, maxNodes: 80000 })
        .then((r) => {
          if (token === game.checkToken && !game.done && !game.busy && r.status === 'solved' && r.moves.length) {
            showHint(r.moves[0]);
          }
        })
        .catch(() => {});
    }
  }

  // `undos` is how many pours to undo, shown on the Undo button; leave it
  // out to keep the count already showing.
  function showStuck(text, undos) {
    game.stuck = true;
    deselect();
    board.classList.add('stuck');
    say(text);
    $('say').classList.add('alert');
    ['undoBtn', 'restartBtn', 'tubeBtn'].forEach((id) => $(id).classList.add('pulse'));
    if (undos !== undefined) {
      $('undoBadge').hidden = !undos;
      $('undoBadge').textContent = undos ? String(undos) : '';
    }
    Sound.oops();
  }

  function clearStuck() {
    game.stuck = false;
    $('undoBadge').hidden = true;
    board.classList.remove('stuck');
    $('say').classList.remove('alert');
    ['undoBtn', 'restartBtn', 'tubeBtn'].forEach((id) => $(id).classList.remove('pulse'));
  }

  // ---------- Winning ----------

  function win() {
    game.done = true;
    clearRun();
    clearHint();
    clearStuck();
    const moves = game.moves;
    const par = game.puzzle.par;
    // There are many ways through a puzzle, so 3 stars allows a little more
    // than the robot's count (none on tiny puzzles), and 2 stars up to half
    // again as many.
    const allowed = par + Math.round(par * STAR_LEEWAY);
    let stars = moves <= allowed ? 3 : moves <= Math.ceil(par * 1.5) ? 2 : 1;
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
    $('winStats').textContent = moves + (moves === 1 ? ' move' : ' moves') + (game.undone ? ' (' + game.undone + ' undone)' : '');
    const allowed = par + Math.round(par * STAR_LEEWAY);
    let note;
    if (moves < par) note = "You beat the robot's record of " + par + ' moves!';
    else if (moves === par) note = "You matched the robot's record!";
    else if (stars === 3) note = "Robot's record: " + par + ' moves. Can you match it?';
    else if (game.helped && moves <= allowed) note = 'Finish without hints or an extra tube for 3 stars.';
    else note = 'Finish in ' + allowed + ' moves or fewer for 3 stars.';
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
    const markFont = getComputedStyle(document.body).getPropertyValue('--font-display');
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
    $('resumeBtn').addEventListener('click', () => saved.run && resumeRun(saved.run));

    // Every button and switch outside the board makes a sound: Play and
    // Mix it get a jingle, the rest a tap. Tubes and the lab tools have
    // sounds of their own.
    // Moving the mouse onto anything clickable pops, so you can hear that the
    // game noticed. Touch screens have no hover, so this is mouse only.
    let hovered = null;
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const found = e.target.closest('button, label.toggle, .chips label');
      const el = found && !found.classList.contains('tube') ? found : null;
      if (el === hovered) return;
      hovered = el;
      const control = el && (el.matches('button') ? el : el.querySelector('input'));
      if (el && control && !control.disabled) Sound.pop();
    });

    document.addEventListener('click', (e) => {
      const el = e.target.closest('button, input[type="checkbox"], input[type="radio"]');
      if (!el || el.disabled || el.closest('.tube, .tool, .step-btn')) return;
      if (['playBtn', 'resumeBtn', 'mixBtn', 'nextBtn'].includes(el.id)) Sound.jingle();
      else Sound.tap();
    });
    $('levelsBtn').addEventListener('click', () => {
      show('levels');
      scrollToCurrent();
    });
    $('jumpForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Math.floor(Number($('jumpInput').value));
      if (n >= 1 && n <= 9999) startLevel(n);
    });
    // Mode switches on Mix your own.
    // Giant Tubes and Mini Tubes can't be combined yet, so turning one on
    // turns the other off.
    const setMode = (change) => {
      const m = saved.custom.modes;
      let swapped = '';
      if (change.giant && m.minis) swapped = 'Giant Tubes and Mini Tubes can\'t be combined yet, so Mini Tubes is off.';
      if (change.minis && m.giant) swapped = 'Giant Tubes and Mini Tubes can\'t be combined yet, so Giant Tubes is off.';
      Object.assign(m, change);
      if (change.giant) m.minis = false;
      if (change.minis) m.giant = 0;
      const { clamped } = clampCustom();
      save();
      renderCustom(clamped);
      if (swapped) {
        $('sizeNote').hidden = false;
        $('sizeNote').textContent = swapped;
      }
    };
    $('modeGiant').addEventListener('change', (e) => {
      const count = Number((document.querySelector('input[name="giants"]:checked') || {}).value) || 1;
      setMode({ giant: e.target.checked ? count : 0 });
    });
    document.querySelectorAll('input[name="giants"]').forEach((r) =>
      r.addEventListener('change', () => setMode({ giant: Number(r.value) }))
    );
    $('modeMinis').addEventListener('change', (e) => setMode({ minis: e.target.checked }));
    $('modeLabels').addEventListener('change', (e) => setMode({ labels: e.target.checked }));
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
    // Closing the card leaves the finished board on screen; Home is one tap
    // away there too.
    $('winClose').innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    $('winClose').addEventListener('click', () => ($('win').hidden = true));
    $('winHome').addEventListener('click', () => {
      game.loadToken++;
      show('home');
    });

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
    $('mysteryToggle').addEventListener('change', (e) => setMode({ mystery: e.target.checked }));
    $('mixBtn').addEventListener('click', () => startCustom(newCustomSpec()));
    $('codeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const spec = parseCode($('codeInput').value);
      const err = $('codeError');
      if (!spec || spec.outdated) {
        err.hidden = false;
        err.textContent = spec
          ? 'That code is from an older version of Color Lab, and its board no longer exists.'
          : 'That code does not look right. It should look like 06422000-1234.';
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
      else if (e.key === 'Escape') {
        if (!$('win').hidden) $('win').hidden = true;
        else deselect();
      }
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

  // ---------- Pause and resume ----------

  // Everything needed to pick a run up again exactly where it was.
  function runSnapshot() {
    return {
      mode: game.mode,
      level: game.level,
      custom: game.custom,
      puzzle: game.puzzle,
      tubes: game.tubes,
      hidden: game.hidden,
      history: game.history,
      helps: game.helps,
      helped: game.helped,
      board: game.board,
      moves: game.moves,
      undone: game.undone,
    };
  }

  /*
   * The current run is saved after every change, so leaving for the home
   * screen, the level map, or another tab (or closing the page) loses
   * nothing. Winning clears it; starting a different level or a new mix
   * replaces it.
   */
  function saveRun() {
    if (!game.puzzle || game.done) return;
    saved.run = runSnapshot();
    save();
  }

  function clearRun() {
    if (!saved.run) return;
    delete saved.run;
    save();
  }

  function resumeRun(g) {
    game.loadToken++;
    Object.assign(game, { mode: g.mode, level: g.level, custom: g.custom });
    setLab(g.mode === 'level' ? Core.labOf(g.level).index : 5);
    show('play');
    $('labName').textContent = g.mode === 'level' ? Core.labOf(g.level).name : 'Your mix';
    $('levelTitle').textContent = g.mode === 'level' ? 'Experiment\u00a0' + g.level : 'Lab code ' + customCode(g.custom);
    setPuzzle(g.puzzle);
    Object.assign(game, {
      tubes: g.tubes,
      hidden: g.hidden,
      history: g.history,
      helps: Object.assign({}, g.helps),
      helped: g.helped,
      board: g.board || game.board,
      moves: g.moves || g.history.length,
      undone: g.undone || 0,
    });
    normalizeHidden();
    buildBoard();
    updateHud();
    say(g.history.length ? 'Welcome back! Pick up where you left off.' : 'Welcome back!');
    if (g.history.length) checkStuck(false);
    if (game.mode === 'level' && game.level === 1) autoHint();
    saveRun();
  }

  // Lets an open copy of the page pick up where it was after an update.
  function snapshot() {
    if (screen !== 'play' || !game.puzzle || game.done) return { screen };
    return { screen, game: runSnapshot() };
  }

  function start(data) {
    wire();
    setSound(saved.sound);
    setShapes(saved.shapes);
    startWorker();
    getLevel(saved.unlocked).catch(() => {});
    const g = data && data.game;
    if (g && g.puzzle) {
      resumeRun(g);
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
