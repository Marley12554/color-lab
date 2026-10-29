/*
 * Color Lab core: the pouring rules, a solver, the difficulty meter, and the
 * level generator. No DOM. Runs in the page, in the worker, and in Node.
 *
 * A puzzle is a list of tubes, each an array of color numbers listed bottom
 * to top, plus its board: how tall each tube is (`caps`) and how many layers
 * make one finished color (`units`). On a classic board every tube is
 * `units` tall, and anywhere a board is expected a plain number means that.
 * Special boards mix heights: a tube taller than `units` has room to spare,
 * and one shorter than `units` can never hold a finished color, so it has to
 * end up empty.
 *
 * The solver works on a string form of the tubes (one character per layer)
 * because strings are cheap to copy and compare.
 */
(function (root) {
  'use strict';

  // ---------- Seeded random numbers ----------

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    let a = (typeof seed === 'number' ? seed : hashString(String(seed))) >>> 0;
    const rng = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.int = (n) => Math.floor(rng() * n);
    return rng;
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // ---------- Rules on arrays (what the game uses) ----------

  function topRun(tube) {
    const n = tube.length;
    if (!n) return { color: -1, count: 0 };
    const c = tube[n - 1];
    let k = 1;
    while (k < n && tube[n - 1 - k] === c) k++;
    return { color: c, count: k };
  }

  // A board is a number (every tube that tall) or { caps, units }.
  function capAt(board, i) {
    return typeof board === 'number' ? board : board.caps[i];
  }

  function unitsOf(board) {
    return typeof board === 'number' ? board : board.units;
  }

  function capsFor(board, count) {
    return typeof board === 'number' ? Array(count).fill(board) : board.caps.slice(0, count);
  }

  // A tube is finished (and capped) when it holds all of one color.
  function isSealed(tube, units) {
    if (tube.length !== units) return false;
    for (let i = 1; i < units; i++) if (tube[i] !== tube[0]) return false;
    return true;
  }

  // Why a pour is not allowed, or null when it is.
  function pourProblem(tubes, board, from, to) {
    if (from === to) return 'same';
    const src = tubes[from];
    const dst = tubes[to];
    const units = unitsOf(board);
    if (!src.length) return 'empty';
    if (isSealed(src, units)) return 'sealed';
    if (isSealed(dst, units)) return 'sealed';
    if (dst.length >= capAt(board, to)) return 'full';
    if (dst.length && dst[dst.length - 1] !== src[src.length - 1]) return 'mismatch';
    return null;
  }

  function pourAmount(tubes, board, from, to) {
    if (pourProblem(tubes, board, from, to)) return 0;
    return Math.min(topRun(tubes[from]).count, capAt(board, to) - tubes[to].length);
  }

  // Pours in place and returns how many layers moved.
  function pour(tubes, board, from, to) {
    const k = pourAmount(tubes, board, from, to);
    for (let i = 0; i < k; i++) tubes[to].push(tubes[from].pop());
    return k;
  }

  function isSolved(tubes, board) {
    const units = unitsOf(board);
    return tubes.every((t) => t.length === 0 || isSealed(t, units));
  }

  // True when some pour would change the picture. Pouring a one-color tube
  // into an empty tube of the same height is legal but changes nothing.
  function hasUsefulMove(tubes, board) {
    for (let f = 0; f < tubes.length; f++) {
      const run = topRun(tubes[f]);
      const uniform = run.count === tubes[f].length;
      for (let t = 0; t < tubes.length; t++) {
        if (pourProblem(tubes, board, f, t)) continue;
        if (uniform && !tubes[t].length && capAt(board, f) === capAt(board, t)) continue;
        return true;
      }
    }
    return false;
  }

  function cloneTubes(tubes) {
    return tubes.map((t) => t.slice());
  }

  // ---------- String form (what the solver uses) ----------

  const BASE = 97; // 'a'

  function encode(tubes) {
    return tubes.map((t) => String.fromCharCode.apply(null, t.map((c) => c + BASE)));
  }

  function decode(state) {
    return state.map((s) => Array.from(s, (ch) => ch.charCodeAt(0) - BASE));
  }

  function sRun(s) {
    const n = s.length;
    if (!n) return 0;
    const c = s.charCodeAt(n - 1);
    let k = 1;
    while (k < n && s.charCodeAt(n - 1 - k) === c) k++;
    return k;
  }

  function sSealed(s, units) {
    return s.length === units && sRun(s) === units;
  }

  function sSolved(state, units) {
    for (let i = 0; i < state.length; i++) {
      const s = state[i];
      if (s.length && !sSealed(s, units)) return false;
    }
    return true;
  }

  // The solver's view of a board: each tube's height, and tags that keep
  // tubes of different heights apart when states are compared.
  function solverBoard(board, count) {
    const caps = capsFor(board, count);
    const same = caps.every((c) => c === caps[0]);
    return { caps, units: unitsOf(board), tags: same ? null : caps.map((c) => c + ':') };
  }

  // Tubes of the same height are interchangeable, so states compare by their
  // sorted tubes (tagged with height when heights differ).
  function keyOf(state, tags) {
    if (!tags) return state.slice().sort().join('|');
    return state.map((s, i) => tags[i] + s).sort().join('|');
  }

  function segments(state) {
    let seg = 0;
    for (let i = 0; i < state.length; i++) {
      const s = state[i];
      if (!s.length) continue;
      seg++;
      for (let j = 1; j < s.length; j++) if (s.charCodeAt(j) !== s.charCodeAt(j - 1)) seg++;
    }
    return seg;
  }

  function colorCount(state) {
    const seen = new Set();
    for (const s of state) for (const ch of s) seen.add(ch);
    return seen.size;
  }

  // Every pour worth trying, as flat triples (from, to, amount). The pruning
  // keeps the search complete: finished tubes are capped and never move,
  // empty tubes of the same height are interchangeable so only the first is
  // tried, and a one-color tube poured into an empty one of its own height
  // gives back the same state.
  function sMoves(state, sb, out) {
    out.length = 0;
    const caps = sb.caps;
    const units = sb.units;
    const firstEmpty = {};
    for (let i = 0; i < state.length; i++) {
      if (!state[i].length && firstEmpty[caps[i]] === undefined) firstEmpty[caps[i]] = i;
    }
    for (let f = 0; f < state.length; f++) {
      const s = state[f];
      if (!s.length || sSealed(s, units)) continue;
      const run = sRun(s);
      const uniform = run === s.length;
      const c = s.charCodeAt(s.length - 1);
      for (let t = 0; t < state.length; t++) {
        if (t === f) continue;
        const d = state[t];
        if (!d.length) {
          if (firstEmpty[caps[t]] !== t || (uniform && caps[t] === caps[f])) continue;
          out.push(f, t, Math.min(run, caps[t]));
        } else {
          if (d.length >= caps[t] || d.charCodeAt(d.length - 1) !== c || sSealed(d, units)) continue;
          out.push(f, t, Math.min(run, caps[t] - d.length));
        }
      }
    }
    return out;
  }

  function sApply(state, f, t, k) {
    const next = state.slice();
    const s = state[f];
    next[f] = s.slice(0, s.length - k);
    next[t] = state[t] + s.slice(s.length - k);
    return next;
  }

  // ---------- Solver ----------

  // Binary min-heap of node ids ordered by a parallel priority array.
  function Heap() {
    this.ids = [];
    this.pri = [];
  }
  Heap.prototype.push = function (id, p) {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= p) break;
      ids[i] = ids[parent];
      pri[i] = pri[parent];
      i = parent;
    }
    ids[i] = id;
    pri[i] = p;
  };
  Heap.prototype.pop = function () {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop();
    const lastP = pri.pop();
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= lastP) break;
        ids[i] = ids[c];
        pri[i] = pri[c];
        i = c;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  };
  Object.defineProperty(Heap.prototype, 'size', {
    get() {
      return this.ids.length;
    },
  });

  /*
   * Best-first search with f = moves so far + weight * (segments - colors).
   * Each pour that empties a source's top section into a matching color
   * removes exactly one segment and nothing removes more, so with weight 1
   * this is A* and the answer is a shortest solution. Larger weights find a
   * solution much faster but not always the shortest.
   *
   * Returns { status: 'solved' | 'unsolvable' | 'unknown', moves, nodes }.
   * 'unsolvable' means every reachable state was tried; 'unknown' means the
   * node budget ran out first. Budgets count nodes, not time, so every device
   * gets the same answer.
   */
  function solve(tubes, board, opts) {
    opts = opts || {};
    const maxNodes = opts.maxNodes || 150000;
    const weight = opts.weight == null ? 2 : opts.weight;
    const start = typeof tubes[0] === 'string' || !tubes.length ? tubes : encode(tubes);
    const sb = solverBoard(board, start.length);
    if (sSolved(start, sb.units)) return { status: 'solved', moves: [], nodes: 0 };

    const colors = colorCount(start);
    const startKey = keyOf(start, sb.tags);
    const states = [start];
    const keys = [startKey];
    const parent = [-1];
    const moveFrom = [-1];
    const moveTo = [-1];
    const depth = [0];
    // Fewest moves found so far to each state. A state is pushed again when
    // a shorter way to it turns up, and the stale entry is skipped on pop.
    const best = new Map([[startKey, 0]]);
    const heap = new Heap();
    const buf = [];
    heap.push(0, weight * (segments(start) - colors));

    let expanded = 0;
    while (heap.size) {
      if (expanded >= maxNodes) return { status: 'unknown', moves: null, nodes: expanded };
      const id = heap.pop();
      if (depth[id] > best.get(keys[id])) continue;
      expanded++;
      const state = states[id];
      const g = depth[id] + 1;
      sMoves(state, sb, buf);
      for (let m = 0; m < buf.length; m += 3) {
        const next = sApply(state, buf[m], buf[m + 1], buf[m + 2]);
        const key = keyOf(next, sb.tags);
        const known = best.get(key);
        if (known !== undefined && known <= g) continue;
        best.set(key, g);
        const nid = states.length;
        states.push(next);
        keys.push(key);
        parent.push(id);
        moveFrom.push(buf[m]);
        moveTo.push(buf[m + 1]);
        depth.push(g);
        if (sSolved(next, sb.units)) {
          const moves = [];
          for (let i = nid; i > 0; i = parent[i]) moves.push([moveFrom[i], moveTo[i]]);
          moves.reverse();
          return { status: 'solved', moves, nodes: expanded };
        }
        const h = segments(next) - colors;
        // Small tie-break toward states closer to done.
        heap.push(nid, g + weight * h + h * 0.001);
      }
    }
    return { status: 'unsolvable', moves: null, nodes: expanded };
  }

  // ---------- Difficulty meter ----------

  /*
   * A pretend player who makes sensible-looking pours but never plans ahead
   * and never undoes. It likes finishing a tube, then moving a whole color
   * section onto its match, then anything else. It never repeats a picture
   * it has already made. It gets stuck when every pour left leads somewhere
   * it has been.
   */
  function playout(start, sb, rng, maxSteps) {
    let state = start;
    const seen = new Set([keyOf(state, sb.tags)]);
    const buf = [];
    const nexts = [];
    const keys = [];
    const weights = [];
    for (let step = 0; step < maxSteps; step++) {
      sMoves(state, sb, buf);
      nexts.length = 0;
      keys.length = 0;
      weights.length = 0;
      let total = 0;
      for (let m = 0; m < buf.length; m += 3) {
        const f = buf[m];
        const t = buf[m + 1];
        const k = buf[m + 2];
        const next = sApply(state, f, t, k);
        const key = keyOf(next, sb.tags);
        if (seen.has(key)) continue;
        let w;
        if (!state[t].length) w = 1;
        else if (sSealed(next[t], sb.units)) w = 12;
        else if (k === sRun(state[f])) w = 4;
        else w = 0.7;
        nexts.push(next);
        keys.push(key);
        weights.push(w);
        total += w;
      }
      if (!nexts.length) return false;
      let r = rng() * total;
      let pick = 0;
      while (pick < weights.length - 1 && r >= weights[pick]) {
        r -= weights[pick];
        pick++;
      }
      state = nexts[pick];
      seen.add(keys[pick]);
      if (sSolved(state, sb.units)) return true;
    }
    return false;
  }

  // Share of pretend players who get stuck: 0 means everyone wins.
  function trapRate(tubes, board, opts) {
    opts = opts || {};
    const runs = opts.playouts || 60;
    const rng = makeRng(opts.seed == null ? 1 : opts.seed);
    const start = typeof tubes[0] === 'string' ? tubes : encode(tubes);
    const sb = solverBoard(board, start.length);
    const maxSteps = opts.maxSteps || 40 + start.length * sb.units * 4;
    let stuck = 0;
    for (let i = 0; i < runs; i++) if (!playout(start, sb, rng, maxSteps)) stuck++;
    return stuck / runs;
  }

  /*
   * What gets a stuck mix going again: how many pours to undo (counting back
   * through `history`, oldest first, the way the game keeps it) and whether
   * one more empty tube would rescue it as it stands. Undos is null when
   * nothing within the history checked can be finished.
   */
  function rescue(current, history, board, opts) {
    opts = opts || {};
    const maxNodes = opts.maxNodes || 25000;
    const lookBack = Math.min(history.length, opts.lookBack || 12);
    let undos = null;
    for (let k = 1; k <= lookBack; k++) {
      if (solve(history[history.length - k], board, { maxNodes }).status !== 'unsolvable') {
        undos = k;
        break;
      }
    }
    let extraTube = false;
    if (opts.extraTube) {
      const units = unitsOf(board);
      const bigger = { caps: capsFor(board, current.length).concat([units]), units };
      extraTube = solve(current.concat([[]]), bigger, { maxNodes }).status !== 'unsolvable';
    }
    return { undos, extraTube };
  }

  // The game's check after each pour: can the mix still be finished, and if
  // not, what gets it going again.
  function checkMix(tubes, board, history, opts) {
    opts = opts || {};
    const status = solve(tubes, board, { maxNodes: opts.maxNodes || 25000 }).status;
    if (status !== 'unsolvable') return { status };
    return Object.assign({ status }, rescue(tubes, history || [], board, opts));
  }

  // ---------- Generator ----------

  /*
   * Where a level sits among candidates of the same size: 0 is the easiest
   * of the batch and 1 the hardest. Size (colors, tube height, empty tubes)
   * does most of the work; this picks easy or tricky deals within a size.
   */
  const DIFFICULTY_PICKS = { easy: 0, medium: 0.45, hard: 0.8, genius: 1 };

  const PALETTE_SIZE = 12;

  // With a single empty tube most deals cannot be finished, so bigger ones
  // take too long to find. These are the most colors allowed per height.
  const ONE_EMPTY_MAX_COLORS = { 3: 12, 4: 9, 5: 7, 6: 6 };

  /*
   * Special boards. Each returns the tubes' heights, how full each starts,
   * and which tubes the layout should feature: one in the middle spanning
   * both rows, or one at each end. Every board leaves about two tubes' worth
   * of room to work with, shaped differently each time.
   */
  const SHAPES = {
    // Plain rows of same-size tubes.
    classic(colors, units, empties) {
      return {
        caps: Array(colors + empties).fill(units),
        fills: Array(colors).fill(units).concat(Array(empties).fill(0)),
      };
    },
    // One giant beaker in the middle, twice as tall, beside a single regular
    // empty tube. (The beaker alone is too little room past a few colors.)
    beaker(colors, units) {
      return {
        caps: Array(colors + 1).fill(units).concat([units * 2]),
        fills: Array(colors).fill(units).concat([0, 0]),
        featured: { center: colors + 1 },
      };
    },
    // A booster at each end, nearly twice as tall as a tube and starting full
    // of mixed colors.
    boosters(colors, units) {
      const booster = units * 2 - 1;
      const rest = colors * units - 2 * booster;
      // With the boosters that makes one more tube than colors, so every
      // color has somewhere to finish and one tube is left over.
      const normal = colors - 1;
      const fills = [];
      for (let i = 0, left = rest; i < normal; i++, left -= units) fills.push(Math.max(0, Math.min(units, left)));
      return {
        caps: [booster].concat(Array(normal).fill(units), [booster]),
        fills: [booster].concat(fills, [booster]),
        featured: { ends: [0, normal + 1] },
      };
    },
    // The empty room comes as several small tubes. Small tubes can never
    // hold a finished color, so they have to end up empty.
    minis(colors, units) {
      const mini = units >= 6 ? 3 : 2;
      const count = Math.ceil((2 * units) / mini);
      return {
        caps: Array(colors).fill(units).concat(Array(count).fill(mini)),
        fills: Array(colors).fill(units).concat(Array(count).fill(0)),
      };
    },
    // Tubes climb in three steps from left to right: one a layer short (it
    // must end empty), regular ones, and two with a layer to spare. Every
    // color needs a tube at least regular height to finish in, so there is
    // always one more of those than there are colors. The room left over
    // ends up in a shuffled few tubes.
    stairs(colors, units, empties, rng) {
      const caps = [units - 1]
        .concat(Array(colors - 1).fill(units))
        .concat([units + 1, units + 1]);
      const fills = caps.slice();
      let spare = caps.reduce((a, b) => a + b, 0) - colors * units;
      const order = shuffle(caps.map((_, i) => i), rng);
      for (const i of order) {
        if (!spare) break;
        const take = Math.min(spare, fills[i]);
        fills[i] -= take;
        spare -= take;
      }
      return { caps, fills };
    },
  };

  const SHAPE_NAMES = Object.keys(SHAPES);

  // With a single empty tube most deals cannot be finished, so bigger ones
  // take too long to find. Special boards have similar limits.
  const SHAPE_MAX_COLORS = {
    beaker: { 3: 12, 4: 12, 5: 12, 6: 12 },
    boosters: { 3: 12, 4: 12, 5: 12, 6: 12 },
    minis: { 3: 12, 4: 12, 5: 12, 6: 12 },
    stairs: { 3: 12, 4: 12, 5: 12, 6: 12 },
  };

  function maxColorsFor(cap, empties, shape) {
    if (shape && shape !== 'classic') return SHAPE_MAX_COLORS[shape][cap];
    return empties <= 1 ? ONE_EMPTY_MAX_COLORS[cap] || 6 : PALETTE_SIZE;
  }

  // The fewest colors a board can be dealt with.
  function minColorsFor(shape) {
    return shape === 'boosters' ? 4 : 2;
  }

  function boardFor(shape, colors, units, empties, rng) {
    const layout = SHAPES[shape || 'classic'](colors, units, empties, rng);
    return { caps: layout.caps, units, fills: layout.fills, featured: layout.featured || null };
  }

  // Shuffles every layer and pours them into the tubes to their starting fill.
  function deal(colors, cap, empties, rng, shape) {
    const board = boardFor(shape, colors, cap, empties, rng);
    const pool = [];
    for (let c = 0; c < colors; c++) for (let k = 0; k < cap; k++) pool.push(c);
    shuffle(pool, rng);
    let at = 0;
    const tubes = board.fills.map((n) => pool.slice(at, (at += n)));
    if (shape && shape !== 'classic') tubes.board = board;
    return tubes;
  }

  // Deals boil down to dull when a tube starts nearly done.
  function dullDeal(tubes, units) {
    for (const t of tubes) {
      if (!t.length) continue;
      if (isSealed(t, units)) return true;
      if (units >= 4 && topRun(t).count >= units - 1) return true;
    }
    return false;
  }

  /*
   * How tricky a solvable deal is. The trap rate says how often a player who
   * does not plan ahead gets stuck. It tops out near 1 on big puzzles, so
   * the second term breaks those ties: how many states the solver had to
   * look at per move of its answer, which grows with backtracking.
   */
  function rate(trap, nodes, par) {
    return trap + 0.25 * Math.log2(Math.max(1, nodes / Math.max(1, par)));
  }

  /*
   * spec: { colors, cap (layers per color), empties, shape, pick (0..1) or
   * difficulty ('easy' ... 'genius'), seed, candidates, playouts, maxDeals,
   * maxNodes }. Special shapes set their own room, so `empties` is only used
   * by the classic shape.
   *
   * The result carries `caps` (each tube's height) and `units` (layers per
   * color); `cap` stays as the layers per color too.
   *
   * Deals from the seed until it has `candidates` solvable deals, ranks them
   * by rate(), and returns the one at `pick`. Everything is seeded and every
   * budget counts steps rather than time, so the same spec always gives the
   * same puzzle on every device.
   */
  function generate(spec) {
    const colors = spec.colors;
    const cap = spec.cap;
    const empties = spec.empties;
    const shape = spec.shape || 'classic';
    const pick = spec.pick != null ? spec.pick : DIFFICULTY_PICKS[spec.difficulty || 'medium'];
    const want = spec.candidates || (empties <= 1 ? 6 : 10);
    const playouts = spec.playouts || 60;
    const maxDeals = spec.maxDeals || 5000;
    const maxNodes = spec.maxNodes || 60000;
    const seed = spec.seed == null ? 1 : spec.seed;

    const found = [];
    let deals = 0;
    for (let k = 0; k < maxDeals && found.length < want; k++) {
      const rng = makeRng(hashString(seed + ':' + k));
      const dealt = deal(colors, cap, empties, rng, shape);
      const board = dealt.board || boardFor('classic', colors, cap, empties, rng);
      const tubes = dealt.slice();
      if (dullDeal(tubes, cap)) continue;
      deals++;
      const start = encode(tubes);
      const result = solve(start, board, { maxNodes, weight: 2 });
      if (result.status !== 'solved') continue;
      const trap = trapRate(start, board, { playouts, seed: hashString('trap:' + seed + ':' + k) });
      found.push({
        tubes,
        board,
        par: result.moves.length,
        solution: result.moves,
        trap,
        nodes: result.nodes,
        rating: rate(trap, result.nodes, result.moves.length),
        attempt: k,
      });
    }
    if (!found.length) return null;
    found.sort((a, b) => a.rating - b.rating || a.attempt - b.attempt);
    const chosen = found[Math.round(Math.min(1, Math.max(0, pick)) * (found.length - 1))];

    // Which of the 12 lab colors this level uses, shuffled per seed.
    const palette = shuffle(
      Array.from({ length: PALETTE_SIZE }, (_, i) => i),
      makeRng(hashString('palette:' + seed))
    ).slice(0, colors);

    return {
      cap,
      units: cap,
      caps: chosen.board.caps,
      featured: chosen.board.featured,
      shape,
      colors,
      empties: shape === 'classic' ? empties : 0,
      tubes: chosen.tubes,
      palette,
      par: chosen.par,
      solution: chosen.solution,
      trap: chosen.trap,
      rating: chosen.rating,
      candidates: found.length,
      deals,
      seed,
    };
  }

  // ---------- Campaign ----------

  /*
   * Ten levels per lab. Each row is [colors, height, empty tubes, pick] with
   * an optional fifth entry: 'm' for mystery layers, or a special board
   * shape. Labs get bigger, and within a lab the pick rises with a couple of
   * easier breathers so it is not a steady grind. New ideas arrive one at a
   * time: the big beaker at 16, taller tubes at 21, mini tubes at 26, one
   * empty tube at 31, mystery layers at 35, rocket boosters at 38, the tallest
   * tubes at 45, the staircase at 46. Every lab after Bubble Lab has at
   * least one special board.
   */
  const LABS = [
    { name: 'Bubble Lab', levels: [
      null, [3, 4, 2, 0], [3, 4, 2, 0.5], [4, 4, 2, 0.2], [4, 4, 2, 0.6],
      [5, 4, 2, 0.2], [4, 4, 2, 0.8], [5, 4, 2, 0.5], [5, 4, 2, 0.8], [6, 4, 2, 0.4],
    ] },
    { name: 'Spark Lab', levels: [
      [5, 4, 2, 0.5], [6, 4, 2, 0.3], [6, 4, 2, 0.6], [5, 4, 2, 0.9], [6, 4, 2, 0.8],
      [5, 4, 0, 0.3, 'beaker'], [6, 4, 2, 0.9], [7, 4, 2, 0.5], [7, 4, 2, 0.7], [8, 4, 2, 0.4],
    ] },
    { name: 'Comet Lab', levels: [
      [5, 5, 2, 0.4], [7, 4, 2, 0.6], [6, 5, 2, 0.4], [7, 4, 2, 0.8], [6, 5, 2, 0.7],
      [6, 4, 0, 0.4, 'minis'], [7, 5, 2, 0.4], [8, 4, 2, 0.7], [7, 5, 2, 0.7], [9, 4, 2, 0.5],
    ] },
    { name: 'Rocket Lab', levels: [
      [4, 4, 1, 0.3], [8, 4, 2, 0.6], [5, 4, 1, 0.4], [8, 5, 2, 0.5], [6, 4, 2, 0.5, 'm'],
      [9, 4, 2, 0.6], [5, 4, 1, 0.7], [8, 4, 0, 0.5, 'boosters'], [9, 4, 2, 0.8], [10, 4, 2, 0.5],
    ] },
    { name: 'Orbit Lab', levels: [
      [6, 4, 1, 0.4], [9, 5, 2, 0.5], [10, 4, 2, 0.6], [7, 4, 2, 0.6, 'm'], [6, 6, 2, 0.5],
      [8, 4, 0, 0.5, 'stairs'], [6, 4, 1, 0.7], [9, 5, 2, 0.8], [7, 6, 2, 0.6], [11, 4, 2, 0.6],
    ] },
    { name: 'Nebula Lab', levels: [
      [7, 4, 1, 0.4], [10, 5, 2, 0.6], [8, 4, 2, 0.7, 'm'], [11, 4, 2, 0.7], [8, 6, 2, 0.6],
      [8, 5, 0, 0.6, 'beaker'], [10, 5, 2, 0.8], [12, 4, 2, 0.5], [8, 4, 1, 0.6], [11, 5, 2, 0.7],
    ] },
    { name: 'Galaxy Lab', levels: [
      [12, 4, 2, 0.7], [9, 6, 2, 0.6], [8, 4, 1, 0.8], [9, 5, 2, 0.6, 'm'], [12, 5, 2, 0.6],
      [9, 4, 0, 0.6, 'minis'], [9, 4, 1, 0.6], [12, 4, 2, 0.9], [10, 5, 0, 0.7, 'boosters'], [12, 5, 2, 0.9],
    ] },
  ];

  // After the last lab the levels keep coming, drawn from these sizes.
  const ENDLESS_SIZES = [
    [12, 4, 2], [12, 5, 2], [11, 6, 2], [10, 6, 2], [11, 5, 2],
    [9, 4, 1], [8, 4, 1], [7, 5, 1], [6, 6, 1], [10, 5, 2, 'm'], [8, 4, 2, 'm'],
    [9, 4, 0, 'beaker'], [7, 6, 0, 'beaker'], [11, 5, 0, 'boosters'], [12, 4, 0, 'stairs'],
    [10, 6, 0, 'stairs'], [8, 5, 0, 'minis'],
  ];
  const ENDLESS_NAMES = ['Star Lab', 'Moon Lab', 'Meteor Lab', 'Planet Lab', 'Quasar Lab', 'Aurora Lab'];

  // Level 1 is built by hand so the first pours teach the two rules.
  const TUTORIAL = { cap: 4, tubes: [[0, 0, 1, 1], [1, 1, 0, 0], []], palette: [1, 7] };

  function labOf(level) {
    const i = Math.floor((level - 1) / 10);
    if (i < LABS.length) return { index: i, name: LABS[i].name };
    const j = i - LABS.length;
    const name = ENDLESS_NAMES[j % ENDLESS_NAMES.length];
    const round = Math.floor(j / ENDLESS_NAMES.length);
    return { index: i, name: round ? name + ' ' + (round + 1) : name };
  }

  function levelSpec(level) {
    const lab = labOf(level);
    const slot = (level - 1) % 10;
    let row;
    if (lab.index < LABS.length) {
      row = LABS[lab.index].levels[slot];
    } else {
      const rng = makeRng(hashString('endless:' + level));
      const size = ENDLESS_SIZES[rng.int(ENDLESS_SIZES.length)];
      row = [size[0], size[1], size[2], 0.5 + 0.5 * rng(), size[3]];
    }
    if (!row) return { level, lab: lab.name, tutorial: true, shape: 'classic' };
    const extra = row[4];
    return {
      level,
      lab: lab.name,
      colors: row[0],
      cap: row[1],
      empties: row[2],
      pick: row[3],
      mystery: extra === 'm',
      shape: extra && extra !== 'm' ? extra : 'classic',
      seed: 'level:' + level,
    };
  }

  function generateLevel(level) {
    const spec = levelSpec(level);
    if (spec.tutorial) {
      const solved = solve(TUTORIAL.tubes, TUTORIAL.cap, { weight: 1 });
      return Object.assign({}, spec, {
        cap: TUTORIAL.cap,
        units: TUTORIAL.cap,
        caps: TUTORIAL.tubes.map(() => TUTORIAL.cap),
        featured: null,
        colors: 2,
        empties: 1,
        tubes: cloneTubes(TUTORIAL.tubes),
        palette: TUTORIAL.palette.slice(),
        par: solved.moves.length,
        solution: solved.moves,
        mystery: false,
      });
    }
    return Object.assign(generate(spec), spec);
  }

  // Help per level. Undo is unlimited, so it is not counted.
  const HELPS = { hints: 3, extraTubes: 1 };

  const api = {
    hashString,
    makeRng,
    shuffle,
    topRun,
    isSealed,
    pourProblem,
    pourAmount,
    pour,
    isSolved,
    hasUsefulMove,
    cloneTubes,
    encode,
    decode,
    keyOf,
    solve,
    playout,
    trapRate,
    rescue,
    checkMix,
    deal,
    boardFor,
    SHAPE_NAMES,
    minColorsFor,
    rate,
    generate,
    labOf,
    levelSpec,
    generateLevel,
    HELPS,
    maxColorsFor,
    DIFFICULTY_PICKS,
    PALETTE_SIZE,
    LAB_COUNT: LABS.length,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ColorLabCore = api;
})(typeof self !== 'undefined' ? self : this);
