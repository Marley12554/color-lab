// For each special board: how many random deals can be finished, and how
// long it takes to find one. Used to set SHAPE_MAX_COLORS in core.js.
const C = require('../js/core.js');
const shapes = process.argv[2] ? [process.argv[2]] : ['beaker', 'boosters', 'minis', 'stairs'];
for (const shape of shapes) {
  for (const units of [4, 5, 6]) {
    for (const colors of [5, 8, 10, 12]) {
      let solvable = 0;
      let deals = 0;
      const t0 = Date.now();
      for (let i = 0; i < 300 && Date.now() - t0 < 3000; i++) {
        const rng = C.makeRng(shape + units + colors + i);
        const tubes = C.deal(colors, units, 0, rng, shape);
        deals++;
        if (C.solve(tubes.slice(), tubes.board, { maxNodes: 60000 }).status === 'solved') solvable++;
      }
      const ms = Date.now() - t0;
      console.log(
        `${shape.padEnd(7)} h${units} ${String(colors).padStart(2)}c: solvable ${solvable}/${deals}, ` +
          `${(ms / deals).toFixed(1)} ms/deal, ~${solvable ? Math.round(ms / solvable) : 'none'} ms per solvable`
      );
    }
  }
}
