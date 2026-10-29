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

  // A board is a number (every tube that tall) or { caps, units, labels }.
  // `labels[i]` is the only color tube i accepts, or -1 for any color.
  function capAt(board, i) {
    return typeof board === 'number' ? board : board.caps[i];
  }

  function unitsOf(board) {
    return typeof board === 'number' ? board : board.units;
  }

  function capsFor(board, count) {
    return typeof board === 'number' ? Array(count).fill(board) : board.caps.slice(0, count);
  }

  function labelAt(board, i) {
    return typeof board === 'number' || !board.labels || board.labels[i] == null ? -1 : board.labels[i];
  }

  function labelsFor(board, count) {
    return Array.from({ length: count }, (_, i) => labelAt(board, i));
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
    const label = labelAt(board, to);
    if (label >= 0 && src[src.length - 1] !== label) return 'label';
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

  // Every tube is empty or one finished color, and every labeled tube holds
  // its finished color.
  function isSolved(tubes, board) {
    const units = unitsOf(board);
    return tubes.every((t, i) => (t.length === 0 && labelAt(board, i) < 0) || isSealed(t, units));
  }

  // True when some pour would change the picture. Pouring a one-color tube
  // into an empty tube of the same height is legal but changes nothing.
  function hasUsefulMove(tubes, board) {
    for (let f = 0; f < tubes.length; f++) {
      const run = topRun(tubes[f]);
      const uniform = run.count === tubes[f].length;
      for (let t = 0; t < tubes.length; t++) {
        if (pourProblem(tubes, board, f, t)) continue;
        if (uniform && !tubes[t].length && capAt(board, f) === capAt(board, t) && labelAt(board, f) === labelAt(board, t)) continue;
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

  function sSolved(state, sb) {
    for (let i = 0; i < state.length; i++) {
      const s = state[i];
      if (s.length ? !sSealed(s, sb.units) : sb.labels[i] >= 0) return false;
    }
    return true;
  }

  // The solver's view of a board: each tube's height and label (as a
  // character code, -1 for none), and tags that keep tubes of different
  // heights or labels apart when states are compared.
  function solverBoard(board, count) {
    const caps = capsFor(board, count);
    const labels = labelsFor(board, count).map((l) => (l >= 0 ? l + BASE : -1));
    const tags = caps.map((c, i) => c + ':' + labels[i] + ':');
    const same = tags.every((t) => t === tags[0]);
    return { caps, labels, units: unitsOf(board), tags: same ? null : tags };
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
  // empty tubes of the same height and label are interchangeable so only
  // the first is tried, and a one-color tube poured into an empty one just
  // like it gives back the same state.
  function sMoves(state, sb, out) {
    out.length = 0;
    const caps = sb.caps;
    const labels = sb.labels;
    const units = sb.units;
    const firstEmpty = {};
    const kind = (i) => (sb.tags ? sb.tags[i] : '');
    for (let i = 0; i < state.length; i++) {
      if (!state[i].length && firstEmpty[kind(i)] === undefined) firstEmpty[kind(i)] = i;
    }
    for (let f = 0; f < state.length; f++) {
      const s = state[f];
      if (!s.length || sSealed(s, units)) continue;
      const run = sRun(s);
      const uniform = run === s.length;
      const c = s.charCodeAt(s.length - 1);
      for (let t = 0; t < state.length; t++) {
        if (t === f) continue;
        if (labels[t] >= 0 && labels[t] !== c) continue;
        const d = state[t];
        if (!d.length) {
          if (firstEmpty[kind(t)] !== t || (uniform && kind(t) === kind(f))) continue;
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
    if (sSolved(start, sb)) return { status: 'solved', moves: [], nodes: 0 };

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
        if (sSolved(next, sb)) {
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
      if (sSolved(state, sb)) return true;
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
   * How much of a puzzle is trial and error: walking along a good route
   * (`solution`), the share of the pours on offer at each position that lead
   * straight into a dead end. 0 means every pour is safe; 0.5 means half of
   * them end the game. Positions are sampled evenly along the route, and a
   * check that runs out of budget counts as safe, so this never overstates.
   *
   * With `opts.limit` ({ share, worst }) it gives up as soon as the puzzle
   * clearly can't meet the limit: one moment over `worst`, or, three or more
   * positions in, a running share over twice `share`. It then reports what
   * it saw so far with `early: true`.
   */
  function deadEndShare(tubes, board, solution, opts) {
    opts = opts || {};
    const samples = opts.samples || 8;
    // Real dead ends are usually small (a dozen or so reachable positions),
    // so a modest search per pour catches nearly all of them.
    const maxNodes = opts.maxNodes || 1000;
    let state = typeof tubes[0] === 'string' ? tubes : encode(tubes);
    const sb = solverBoard(board, state.length);
    const route = [state];
    for (const [f, t] of solution) {
      const k = Math.min(sRun(state[f]), sb.caps[t] - state[t].length);
      state = sApply(state, f, t, k);
      route.push(state);
    }
    const stops = Math.max(1, route.length - 1);
    const picks = new Set();
    for (let i = 0; i < Math.min(samples, stops); i++) picks.add(Math.floor((i * stops) / Math.min(samples, stops)));
    const buf = [];
    let fatal = 0;
    let total = 0;
    let worst = 0;
    let seen = 0;
    const limit = opts.limit;
    for (const i of picks) {
      const here = route[i];
      sMoves(here, sb, buf);
      let bad = 0;
      let options = 0;
      for (let m = 0; m < buf.length; m += 3) {
        const next = sApply(here, buf[m], buf[m + 1], buf[m + 2]);
        options++;
        if (!sSolved(next, sb) && solve(next, board, { maxNodes }).status === 'unsolvable') bad++;
      }
      fatal += bad;
      total += options;
      seen++;
      if (options) worst = Math.max(worst, bad / options);
      if (limit && (worst > limit.worst || (seen >= 3 && fatal / total > 2 * limit.share))) {
        return { share: fatal / total, worst, early: true };
      }
    }
    return { share: total ? fatal / total : 0, worst };
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
      const bigger = {
        caps: capsFor(board, current.length).concat([units]),
        labels: labelsFor(board, current.length).concat([-1]),
        units,
      };
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
   * Modes change the rules of a board, and they stack:
   * - giant (0, 1, or 2): giant tubes twice as tall, packed full of mixed
   *   colors at the start. One stands in the middle, two stand at the ends.
   * - minis: the spare room comes as small tubes that hold 2 or 3 layers.
   *   A small tube can never hold a finished color, so it must end empty.
   * - labels: one to three empty tubes that each take only one color, and
   *   must end up holding it.
   * - mystery: layers stay hidden until uncovered (the game handles this).
   * With no modes it is the classic board.
   */
  const NO_MODES = { giant: 0, minis: false, labels: false, mystery: false };

  function normalizeModes(modes) {
    const m = Object.assign({}, NO_MODES, modes || {});
    m.giant = Math.max(0, Math.min(2, m.giant | 0));
    m.minis = !!m.minis;
    m.labels = !!m.labels;
    m.mystery = !!m.mystery;
    return m;
  }

  // True when the board itself differs from classic (mystery doesn't).
  function hasBoardModes(modes) {
    const m = normalizeModes(modes);
    return m.giant > 0 || m.minis || m.labels;
  }

  function labelCount(colors) {
    return colors <= 4 ? 1 : colors <= 8 ? 2 : 3;
  }

  // The fewest colors that make every chosen mode matter.
  function minColorsFor(modes) {
    const m = normalizeModes(modes);
    let min = 2;
    if (m.giant) min = Math.max(min, 2 * m.giant + 2);
    if (m.labels) min = Math.max(min, 3);
    return min;
  }

  /*
   * Builds the tubes for a board: each one's height, how full it starts, and
   * its label, plus which tubes the layout features. `empties` is how many
   * tubes' worth of free room the board has. Every color needs a tube it can
   * finish in, so the builder keeps enough regular tubes for that, plus one
   * spare when the free room isn't all small tubes.
   */
  function boardFor(modes, colors, units, empties, rng) {
    const m = normalizeModes(modes);
    const g = m.giant;
    const caps = [];
    const fills = [];
    const labels = [];
    const add = (cap, fill, label) => {
      caps.push(cap);
      fills.push(fill);
      labels.push(label == null ? -1 : label);
    };
    for (let i = 0; i < colors - 2 * g; i++) add(units, units);
    const L = m.labels ? labelCount(colors) : 0;
    if (L) {
      const chosen = shuffle(Array.from({ length: colors }, (_, i) => i), rng).slice(0, L);
      chosen.sort((a, b) => a - b).forEach((c) => add(units, 0, c));
    }
    // Free regular tubes. Giant tubes take the place of two full tubes but
    // only finish one color, so each one beyond the first needs a free tube
    // to make up for it; labeled tubes are themselves free room, so they
    // replace one regular free tube.
    let free = Math.max(1, empties + Math.max(0, g - 1) - (L ? 1 : 0), g - L + 1);
    if (m.minis) {
      // Keep only the regular free tubes some color must finish in; the rest
      // of the room comes as small tubes.
      const keep = Math.max(0, g - L);
      const mini = units >= 6 ? 3 : 2;
      const room = Math.max(1, free - keep) * units;
      for (let i = 0; i < keep; i++) add(units, 0);
      for (let i = 0; i < Math.max(2, Math.ceil(room / mini)); i++) add(mini, 0);
      free = 0;
    }
    for (let i = 0; i < free; i++) add(units, 0);
    let featured = null;
    if (g === 1) featured = { center: caps.length };
    if (g === 2) featured = { ends: [caps.length, caps.length + 1] };
    for (let i = 0; i < g; i++) add(units * 2, units * 2);
    return { caps, units, labels, fills, featured };
  }

  // With a single empty tube most deals cannot be finished (and the ones
  // that can are full of dead ends), so bigger ones are not offered.
  function maxColorsFor(cap, empties, modes) {
    const m = normalizeModes(modes);
    // Small tubes plus labeled tubes give many pours to check at every step,
    // so past 8 colors a fair puzzle takes too long to find.
    if (m.minis && m.labels) return 8;
    if (hasBoardModes(m)) return PALETTE_SIZE;
    return empties <= 1 ? ONE_EMPTY_MAX_COLORS[cap] || 6 : PALETTE_SIZE;
  }

  // Shuffles every layer and pours them into the tubes to their starting
  // fill. The board rides along on the result as `.board`.
  function deal(colors, cap, empties, rng, modes) {
    const board = boardFor(modes, colors, cap, empties, rng);
    const pool = [];
    for (let c = 0; c < colors; c++) for (let k = 0; k < cap; k++) pool.push(c);
    shuffle(pool, rng);
    let at = 0;
    const tubes = board.fills.map((n) => pool.slice(at, (at += n)));
    tubes.board = board;
    return tubes;
  }

  /*
   * Whether the modes actually change this puzzle. Mini tubes must be
   * needed: without them it can't be finished. With labels on too, the
   * labeled tubes are room of their own, so there the mini tubes only have
   * to be part of the solver's route (two or more pours into them). Labels
   * must get in the way: the solver's answer with the labels ignored has to
   * break them. (Giant tubes always matter, since they start full.)
   */
  function modesMatter(tubes, board, modes, solution) {
    const m = normalizeModes(modes);
    if (m.minis && m.labels && solution) {
      const intoMinis = solution.filter(([, t]) => board.caps[t] < board.units).length;
      if (intoMinis < 2) return false;
    } else if (m.minis) {
      const keep = board.caps.map((c) => c >= board.units);
      const without = {
        caps: board.caps.filter((_, i) => keep[i]),
        labels: board.labels.filter((_, i) => keep[i]),
        units: board.units,
      };
      if (solve(tubes.filter((_, i) => keep[i]), without, { maxNodes: 20000 }).status === 'solved') return false;
    }
    if (m.labels) {
      const plain = { caps: board.caps, units: board.units };
      const r = solve(tubes, plain, { maxNodes: 20000 });
      if (r.status === 'solved') {
        const state = cloneTubes(tubes);
        let broke = false;
        for (const [f, t] of r.moves) {
          if (pourProblem(state, board, f, t)) broke = true;
          pour(state, plain, f, t);
        }
        if (!broke && isSolved(state, board)) return false;
      }
    }
    return true;
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
   * Difficulty should come from planning, not from guessing which pour is a
   * trap. A puzzle is fair when, along a good route, at most 10% of the pours
   * on offer lead straight into a dead end and no single moment has more
   * than half of them fatal. Every difficulty, Genius included, picks only
   * among fair puzzles.
   */
  const FAIR = { share: 0.1, worst: 0.5 };

  /*
   * spec: { colors, cap (layers per color), empties (tubes' worth of free
   * room), modes, pick (0..1) or difficulty ('easy' ... 'genius'), seed,
   * candidates, playouts, maxDeals, maxNodes }.
   *
   * The result carries `caps` (each tube's height) and `units` (layers per
   * color); `cap` stays as the layers per color too.
   *
   * Deals from the seed until it has `candidates` fair deals, ranks them by
   * rate(), and returns the one at `pick`. Some sizes (one empty tube, from
   * about six colors) almost never deal a fair puzzle; then the deals with
   * the fewest dead ends are ranked instead. Everything is seeded and every
   * budget counts steps rather than time, so the same spec always gives the
   * same puzzle on every device.
   */
  function generate(spec) {
    const colors = spec.colors;
    const cap = spec.cap;
    const empties = spec.empties;
    const modes = normalizeModes(spec.modes);
    const pick = spec.pick != null ? spec.pick : DIFFICULTY_PICKS[spec.difficulty || 'medium'];
    const want = spec.candidates || 6;
    const playouts = spec.playouts || 60;
    const maxDeals = spec.maxDeals || 5000;
    const maxSolvable = spec.maxSolvable || want * 6;
    // Most solvable deals solve within a few hundred steps; a deal that takes
    // more than this is skipped rather than worked on for seconds.
    const maxNodes = spec.maxNodes || 12000;
    const seed = spec.seed == null ? 1 : spec.seed;

    const found = [];
    const unfair = [];
    let deals = 0;
    let solvable = 0;
    for (let k = 0; k < maxDeals && found.length < want && solvable < maxSolvable; k++) {
      const rng = makeRng(hashString(seed + ':' + k));
      const dealt = deal(colors, cap, empties, rng, modes);
      const board = dealt.board;
      const tubes = dealt.slice();
      if (dullDeal(tubes, cap)) continue;
      deals++;
      const start = encode(tubes);
      const result = solve(start, board, { maxNodes, weight: 2 });
      if (result.status !== 'solved') continue;
      if (!modesMatter(tubes, board, modes, result.moves)) continue;
      solvable++;
      const dead = deadEndShare(start, board, result.moves, { limit: FAIR });
      const entry = { tubes, board, start, result, dead, attempt: k };
      if (dead.share <= FAIR.share && dead.worst <= FAIR.worst) found.push(entry);
      else unfair.push(entry);
    }
    if (!found.length) {
      if (!unfair.length) return null;
      unfair.sort((a, b) => a.dead.share - b.dead.share || a.dead.worst - b.dead.worst || a.attempt - b.attempt);
      found.push(...unfair.slice(0, Math.min(3, want)));
    }
    // The trap rate is only worth working out for the deals still in the running.
    for (const e of found) {
      const trap = trapRate(e.start, e.board, { playouts, seed: hashString('trap:' + seed + ':' + e.attempt) });
      Object.assign(e, {
        par: e.result.moves.length,
        solution: e.result.moves,
        trap,
        nodes: e.result.nodes,
        rating: rate(trap, e.result.nodes, e.result.moves.length),
      });
    }
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
      labels: chosen.board.labels,
      featured: chosen.board.featured,
      modes,
      mystery: modes.mystery,
      colors,
      empties,
      tubes: chosen.tubes,
      palette,
      par: chosen.par,
      solution: chosen.solution,
      trap: chosen.trap,
      rating: chosen.rating,
      deadEnds: chosen.dead.share,
      fair: chosen.dead.share <= FAIR.share && chosen.dead.worst <= FAIR.worst,
      candidates: found.length,
      deals,
      seed,
    };
  }

  // ---------- Campaign ----------

  /*
   * Ten levels per lab. Each row is [colors, height, empty tubes, pick] with
   * an optional fifth entry listing modes: 'g1' or 'g2' (giant tubes),
   * 'mini', 'label', and 'm' (mystery layers). Labs get bigger, and within
   * a lab the pick rises with a couple of easier breathers so it is not a
   * steady grind. New ideas arrive one at a time: a giant tube at 16, taller
   * tubes at 21, mini tubes at 26, one empty tube at 31, mystery layers at
   * 35, labeled tubes at 38, the tallest tubes at 45, two giant tubes at 46,
   * and from 56 on, some levels mix two modes.
   */
  const LABS = [
    { name: 'Bubble Lab', levels: [
      null, [3, 4, 2, 0], [3, 4, 2, 0.5], [4, 4, 2, 0.2], [4, 4, 2, 0.6],
      [5, 4, 2, 0.2], [4, 4, 2, 0.8], [5, 4, 2, 0.5], [5, 4, 2, 0.8], [6, 4, 2, 0.4],
    ] },
    { name: 'Spark Lab', levels: [
      [5, 4, 2, 0.5], [6, 4, 2, 0.3], [6, 4, 2, 0.6], [5, 4, 2, 0.9], [6, 4, 2, 0.8],
      [5, 4, 2, 0.3, 'g1'], [6, 4, 2, 0.9], [7, 4, 2, 0.5], [7, 4, 2, 0.7], [8, 4, 2, 0.4],
    ] },
    { name: 'Comet Lab', levels: [
      [5, 5, 2, 0.4], [7, 4, 2, 0.6], [6, 5, 2, 0.4], [7, 4, 2, 0.8], [6, 5, 2, 0.7],
      [6, 4, 2, 0.4, 'mini'], [7, 5, 2, 0.4], [8, 4, 2, 0.7], [7, 5, 2, 0.7], [9, 4, 2, 0.5],
    ] },
    { name: 'Rocket Lab', levels: [
      [4, 4, 1, 0.3], [8, 4, 2, 0.6], [5, 4, 1, 0.4], [8, 5, 2, 0.5], [6, 4, 2, 0.5, 'm'],
      [9, 4, 2, 0.6], [5, 4, 1, 0.7], [7, 4, 2, 0.5, 'label'], [9, 4, 2, 0.8], [10, 4, 2, 0.5],
    ] },
    { name: 'Orbit Lab', levels: [
      [8, 5, 2, 0.4], [9, 5, 2, 0.5], [10, 4, 2, 0.6], [7, 4, 2, 0.6, 'm'], [6, 6, 2, 0.5],
      [8, 4, 2, 0.5, 'g2'], [6, 4, 1, 0.7], [9, 5, 2, 0.8], [7, 6, 2, 0.6], [11, 4, 2, 0.6],
    ] },
    { name: 'Nebula Lab', levels: [
      [9, 6, 2, 0.4], [10, 5, 2, 0.6], [8, 4, 2, 0.7, 'm'], [11, 4, 2, 0.7], [8, 6, 2, 0.6],
      [8, 5, 2, 0.6, 'g1 label'], [10, 5, 2, 0.8], [12, 4, 2, 0.5], [8, 4, 1, 0.6], [11, 5, 2, 0.7],
    ] },
    { name: 'Galaxy Lab', levels: [
      [12, 4, 2, 0.7], [9, 6, 2, 0.6], [8, 4, 1, 0.8], [9, 5, 2, 0.6, 'm'], [12, 5, 2, 0.6],
      [9, 4, 2, 0.6, 'mini m'], [11, 6, 2, 0.6], [12, 4, 2, 0.9], [10, 5, 2, 0.7, 'g2 mini'], [12, 5, 2, 0.9],
    ] },
  ];

  // After the last lab the levels keep coming, drawn from these sizes.
  const ENDLESS_SIZES = [
    [12, 4, 2], [12, 5, 2], [11, 6, 2], [10, 6, 2], [11, 5, 2],
    [6, 4, 1], [11, 6, 2], [10, 5, 2, 'm'], [8, 4, 2, 'm'],
    [9, 4, 2, 'g1'], [7, 6, 2, 'g1'], [11, 5, 2, 'g2'], [12, 4, 2, 'label'],
    [10, 6, 2, 'mini'], [8, 5, 2, 'g1 label'], [8, 4, 2, 'mini label'],
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

  // 'g1 label' -> { giant: 1, labels: true, ... }
  function parseModes(text) {
    const words = (text || '').split(/\s+/);
    return normalizeModes({
      giant: words.includes('g2') ? 2 : words.includes('g1') ? 1 : 0,
      minis: words.includes('mini'),
      labels: words.includes('label'),
      mystery: words.includes('m'),
    });
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
    if (!row) return { level, lab: lab.name, tutorial: true, modes: normalizeModes() };
    const modes = parseModes(row[4]);
    return {
      level,
      lab: lab.name,
      colors: row[0],
      cap: row[1],
      empties: row[2],
      pick: row[3],
      modes,
      mystery: modes.mystery,
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
        labels: TUTORIAL.tubes.map(() => -1),
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
    deadEndShare,
    deal,
    boardFor,
    normalizeModes,
    hasBoardModes,
    parseModes,
    modesMatter,
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
