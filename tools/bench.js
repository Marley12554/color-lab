// Measures random deals per config: solvable share, trap-rate spread, solver cost.
const C = require('../js/core.js');
const configs = process.argv.slice(2).map(s => s.split('-').map(Number)); // colors-cap-empties
for (const [colors, cap, empties] of configs) {
  const traps = [], times = [], nodes = [], pars = [];
  let unsolved = 0, unknown = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const rng = C.makeRng(1000 + i);
    const tubes = C.deal(colors, cap, empties, rng);
    const t0 = Date.now();
    const r = C.solve(tubes, cap, { maxNodes: 60000, weight: 2 });
    const t1 = Date.now();
    times.push(t1 - t0); nodes.push(r.nodes);
    if (r.status === 'unsolvable') { unsolved++; continue; }
    if (r.status === 'unknown') { unknown++; continue; }
    pars.push(r.moves.length);
    const t2 = Date.now();
    traps.push(C.trapRate(tubes, cap, { playouts: 60, seed: i }));
    times[times.length-1] += Date.now() - t2;
  }
  traps.sort((a,b)=>a-b); times.sort((a,b)=>a-b); pars.sort((a,b)=>a-b);
  const q = (a,p) => a.length ? a[Math.min(a.length-1, Math.floor(p*a.length))] : NaN;
  console.log(`${colors}c cap${cap} e${empties}: solvable ${N-unsolved-unknown}/${N} (unsolv ${unsolved}, unk ${unknown}) | trap p10 ${q(traps,.1).toFixed(2)} p50 ${q(traps,.5).toFixed(2)} p90 ${q(traps,.9).toFixed(2)} | par p50 ${q(pars,.5)} | ms p50 ${q(times,.5)} p90 ${q(times,.9)} max ${times[times.length-1]}`);
}
