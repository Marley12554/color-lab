// Prints every campaign level's size, rating, and generation time.
const C = require('../js/core.js');
const from = Number(process.argv[2] || 1), to = Number(process.argv[3] || 80);
let worst = 0;
for (let n = from; n <= to; n++) {
  const t0 = Date.now();
  const p = C.generateLevel(n);
  const ms = Date.now() - t0; worst = Math.max(worst, ms);
  const s = C.levelSpec(n);
  console.log(`${String(n).padStart(3)} ${s.lab.padEnd(11)} ${s.tutorial ? 'tutorial' : `${s.colors}c h${s.cap} e${s.empties}${s.mystery ? ' m' : '  '} pick ${s.pick.toFixed(2)}`} | par ${String(p.par).padStart(3)} trap ${(p.trap ?? 0).toFixed(2)} rating ${(p.rating ?? 0).toFixed(2)} | ${ms}ms`);
}
console.log('slowest', worst, 'ms');
