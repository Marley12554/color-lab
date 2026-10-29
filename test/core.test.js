const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

// Plain breadth-first search with no pruning and no tube-order tricks,
// to check the real solver against.
function bruteForce(tubes, cap) {
  const start = C.cloneTubes(tubes);
  const key = (t) => JSON.stringify(t);
  const seen = new Set([key(start)]);
  let frontier = [start];
  for (let depth = 0; frontier.length; depth++) {
    const next = [];
    for (const state of frontier) {
      if (C.isSolved(state, cap)) return depth;
      for (let f = 0; f < state.length; f++) {
        for (let t = 0; t < state.length; t++) {
          if (!C.pourAmount(state, cap, f, t)) continue;
          const copy = C.cloneTubes(state);
          C.pour(copy, cap, f, t);
          const k = key(copy);
          if (!seen.has(k)) {
            seen.add(k);
            next.push(copy);
          }
        }
      }
    }
    frontier = next;
  }
  return -1;
}

function replay(tubes, cap, moves) {
  const state = C.cloneTubes(tubes);
  for (const [f, t] of moves) {
    assert.ok(C.pourAmount(state, cap, f, t) > 0, `illegal move ${f}->${t}`);
    C.pour(state, cap, f, t);
  }
  return state;
}

test('a pour moves the whole matching top section that fits', () => {
  const tubes = [[0, 1, 1], [2, 1], []];
  assert.equal(C.pour(tubes, 4, 0, 1), 2);
  assert.deepEqual(tubes, [[0], [2, 1, 1, 1], []]);
});

test('a pour stops when the target fills up', () => {
  const tubes = [[1, 1, 1], [0, 0, 1], []];
  assert.equal(C.pour(tubes, 4, 0, 1), 1);
  assert.deepEqual(tubes, [[1, 1], [0, 0, 1, 1], []]);
});

test('pour problems are named', () => {
  const tubes = [[0, 1], [0, 0], [2, 2, 2, 2], [], [0, 1, 2, 0]];
  assert.equal(C.pourProblem(tubes, 4, 0, 1), 'mismatch');
  assert.equal(C.pourProblem(tubes, 4, 3, 0), 'empty');
  assert.equal(C.pourProblem(tubes, 4, 2, 3), 'sealed');
  assert.equal(C.pourProblem(tubes, 4, 1, 4), 'full');
  assert.equal(C.pourProblem(tubes, 4, 0, 0), 'same');
  assert.equal(C.pourProblem(tubes, 4, 0, 3), null);
});

test('solved means every tube is empty or one full color', () => {
  assert.ok(C.isSolved([[1, 1, 1], [], [0, 0, 0]], 3));
  assert.ok(!C.isSolved([[1, 1], [1], [0, 0, 0]], 3));
});

test('the solver agrees with brute force on small puzzles', () => {
  let solvable = 0;
  let unsolvable = 0;
  for (let i = 0; i < 300; i++) {
    const rng = C.makeRng(i);
    const colors = 2 + rng.int(3);
    const cap = 3 + rng.int(2);
    const empties = 1 + rng.int(2);
    const tubes = C.deal(colors, cap, empties, rng);
    const shortest = bruteForce(tubes, cap);
    const exact = C.solve(tubes, cap, { weight: 1, maxNodes: 1e6 });
    const fast = C.solve(tubes, cap, { weight: 2, maxNodes: 1e6 });
    if (shortest < 0) {
      unsolvable++;
      assert.equal(exact.status, 'unsolvable', `deal ${i}`);
      assert.equal(fast.status, 'unsolvable', `deal ${i}`);
    } else {
      solvable++;
      assert.equal(exact.status, 'solved', `deal ${i}`);
      assert.equal(exact.moves.length, shortest, `deal ${i} is not shortest`);
      assert.ok(C.isSolved(replay(tubes, cap, exact.moves), cap));
      assert.ok(C.isSolved(replay(tubes, cap, fast.moves), cap));
    }
  }
  // The sample should exercise both outcomes.
  assert.ok(solvable > 50 && unsolvable > 20, `${solvable} solvable, ${unsolvable} not`);
});

test('the solver reports unknown when the budget runs out', () => {
  const tubes = C.deal(12, 6, 2, C.makeRng(3));
  const result = C.solve(tubes, 6, { maxNodes: 5 });
  assert.equal(result.status, 'unknown');
});

test('the same spec always generates the same puzzle', () => {
  const spec = { colors: 7, cap: 4, empties: 2, pick: 0.6, seed: 'same' };
  const a = C.generate(spec);
  const b = C.generate(spec);
  assert.deepEqual(a.tubes, b.tubes);
  assert.deepEqual(a.palette, b.palette);
  assert.notDeepEqual(C.generate({ ...spec, seed: 'other' }).tubes, a.tubes);
});

test('a higher pick gives a puzzle rated at least as tricky', () => {
  for (const seed of ['p1', 'p2', 'p3']) {
    const base = { colors: 8, cap: 4, empties: 2, seed };
    const easy = C.generate({ ...base, difficulty: 'easy' });
    const genius = C.generate({ ...base, difficulty: 'genius' });
    assert.ok(genius.rating >= easy.rating);
  }
});

test('generated puzzles are solvable, fair, and use distinct lab colors', () => {
  const specs = [
    [3, 4, 2], [6, 4, 2], [9, 5, 2], [12, 4, 2], [12, 6, 2],
    [5, 4, 1], [9, 4, 1], [7, 5, 1], [6, 6, 1], [12, 3, 1], [2, 3, 3],
  ];
  for (const [colors, cap, empties] of specs) {
    const p = C.generate({ colors, cap, empties, seed: `fair-${colors}-${cap}-${empties}` });
    assert.ok(p, `no puzzle for ${colors}-${cap}-${empties}`);
    assert.equal(p.tubes.length, colors + empties);
    assert.ok(C.isSolved(replay(p.tubes, cap, p.solution), cap));
    assert.equal(new Set(p.palette).size, colors);
    for (let c = 0; c < colors; c++) {
      const count = p.tubes.flat().filter((x) => x === c).length;
      assert.equal(count, cap, `color ${c} should fill exactly one tube`);
    }
    for (const t of p.tubes) assert.ok(!C.isSealed(t, cap), 'no tube starts finished');
  }
});

test('the first 80 campaign levels generate and can be finished', () => {
  for (let level = 1; level <= 80; level++) {
    const spec = C.levelSpec(level);
    if (!spec.tutorial) {
      assert.ok(spec.colors <= C.maxColorsFor(spec.cap, spec.empties), `level ${level} is too big`);
    }
    const p = C.generateLevel(level);
    assert.ok(p && p.tubes, `level ${level}`);
    assert.ok(C.isSolved(replay(p.tubes, p.cap, p.solution), p.cap), `level ${level}`);
    assert.equal(p.par, p.solution.length);
  }
});

test('labs are named in tens and keep going after the last one', () => {
  assert.equal(C.labOf(1).name, 'Bubble Lab');
  assert.equal(C.labOf(10).name, 'Bubble Lab');
  assert.equal(C.labOf(11).name, 'Spark Lab');
  assert.equal(C.labOf(71).name, 'Star Lab');
  assert.equal(C.labOf(71 + 60).name, 'Star Lab 2');
  assert.ok(!C.levelSpec(500).tutorial);
});

test('useful moves ignore pouring a one-color tube into an empty one', () => {
  assert.equal(C.hasUsefulMove([[0, 0], [1, 1, 1], []], 3), false);
  assert.equal(C.hasUsefulMove([[0, 1, 0], [1, 0, 1]], 3), false);
  assert.equal(C.hasUsefulMove([[0, 1], [1], []], 3), true);
});
