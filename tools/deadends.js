// How much trial and error each campaign level asks for: the share of pours
// on offer (along a good route) that lead straight into a dead end.
// Usage: node tools/deadends.js [from] [to]
const C = require('../js/core.js');
const from = Number(process.argv[2] || 1);
const to = Number(process.argv[3] || 70);
for (let n = from; n <= to; n++) {
  const p = C.generateLevel(n);
  const s = C.levelSpec(n);
  const board = { caps: p.caps, units: p.units };
  const t0 = Date.now();
  const d = C.deadEndShare(p.tubes, board, p.fairRoute || p.solution);
  const size = s.tutorial ? 'tutorial' : `${s.colors}c h${s.cap} e${s.empties}${(s.modes.giant ? ' giant' + s.modes.giant : '') + (s.modes.minis ? ' mini' : '') + (s.modes.labels ? ' label' : '')}`;
  console.log(
    `${String(n).padStart(3)} ${size.padEnd(20)} dead-end share ${(d.share * 100).toFixed(0).padStart(3)}%  worst spot ${(d.worst * 100).toFixed(0).padStart(3)}%  (${Date.now() - t0}ms)`
  );
}
