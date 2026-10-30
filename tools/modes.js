// Times the generator on big custom mixes for each mode combination and
// reports whether the result is fair. Usage: node tools/modes.js [colors] [height]
const C = require('../js/core.js');
const colors = Number(process.argv[2] || 12);
const cap = Number(process.argv[3] || 6);
const sets = ['', 'g1', 'g2', 'mini', 'label', 'g1 label', 'g2 label', 'mini label'];
for (const text of sets) {
  const modes = C.parseModes(text);
  for (const difficulty of ['medium', 'genius']) {
    const t0 = Date.now();
    const p = C.generate({ colors, cap, empties: Math.max(2, C.minEmptiesFor(modes)), modes, difficulty, seed: 'bench:' + text });
    const ms = Date.now() - t0;
    console.log(
      `${(text || 'classic').padEnd(14)} ${difficulty.padEnd(7)} ${p ? `par ${p.par} rating ${p.rating.toFixed(2)} dead ends ${(p.deadEnds * 100).toFixed(0)}% fair ${p.fair}` : 'NONE'} | ${ms}ms`
    );
  }
}
