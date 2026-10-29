// Plays whole levels through the real UI (animations off) and checks the tools.
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://localhost:8765/index.html';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let failures = 0;
  const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
  async function open(level) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.addInitScript((n) => localStorage.setItem('color-lab-v1', JSON.stringify({ unlocked: n, sound: false })), level);
    await p.goto(url);
    await p.click('#playBtn');
    await p.waitForSelector('.tube');
    return p;
  }
  const tube = (p, i) => p.locator('.tube').nth(i);
  const moves = async (p) => Number(await p.textContent('#moveCount'));
  async function pour(p, f, t) {
    await tube(p, f).click();
    await tube(p, t).click();
    await p.waitForFunction(() => !document.querySelector('.tube.pouring'));
  }

  for (const level of [2, 12, 31, 35, 47, 61]) {
    const p = await open(level);
    // The worker's puzzle must match the page's own copy of the generator.
    const sol = await p.evaluate((n) => {
      const lv = window.ColorLabCore.generateLevel(n);
      return { solution: lv.solution, tubes: lv.tubes.length };
    }, level);
    check((await p.locator('.tube').count()) === sol.tubes, `level ${level} tube count`);
    // One pour, then undo it.
    const [f0, t0] = sol.solution[0];
    await pour(p, f0, t0);
    check((await moves(p)) === 1, `level ${level} move counted`);
    await p.click('#undoBtn');
    check((await moves(p)) === 0, `level ${level} undo`);
    // An extra tube adds one empty tube at the end and does not shift indices.
    if (level === 12) {
      await p.click('#tubeBtn');
      check((await p.locator('.tube').count()) === sol.tubes + 1, 'extra tube added');
      check(await p.isDisabled('#tubeBtn'), 'only one extra tube');
      await p.click('#hintBtn');
      await p.waitForSelector('.tube.hint-from');
      check((await p.textContent('#hintBadge')) === '2', 'hint used');
      // Asking again before changing anything repeats the hint for free.
      for (let i = 0; i < 3; i++) await p.click('#hintBtn');
      await p.waitForTimeout(200);
      check((await p.textContent('#hintBadge')) === '2', 'repeat hint is free');
      check((await p.locator('.tube.hint-from').count()) === 1, 'same hint still shown');
      // After a pour, the next hint costs one again.
      const [hf, ht] = await p.evaluate(() => [
        [...document.querySelectorAll('.tube')].findIndex((t) => t.classList.contains('hint-from')),
        [...document.querySelectorAll('.tube')].findIndex((t) => t.classList.contains('hint-to')),
      ]);
      await pour(p, hf, ht);
      await p.click('#hintBtn');
      await p.waitForSelector('.tube.hint-from');
      check((await p.textContent('#hintBadge')) === '1', 'new hint after a pour costs one');
      await p.click('#restartBtn');
      await p.click('#tubeBtn');
    }
    for (const [f, t] of sol.solution) await pour(p, f, t);
    await p.waitForSelector('#win:not([hidden])', { timeout: 5000 });
    const stars = await p.locator('#winStars i.on').count();
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('color-lab-v1')));
    console.log(`level ${level}: won in ${await moves(p)} moves, ${stars} stars, unlocked ${saved.unlocked}`);
    check(saved.unlocked === level + 1, `level ${level} unlocks the next`);
    check(level === 12 ? stars === 2 : stars === 3, `level ${level} stars`);
    await p.context().close();
  }

  // Random pours on a hard one-empty-tube level until it is stuck or won.
  const p = await open(33);
  let banner = false;
  for (let i = 0; i < 80 && !banner; i++) {
    const legal = await p.evaluate(() => {
      const els = [...document.querySelectorAll('.tube')];
      return els.length;
    });
    const f = Math.floor(Math.random() * legal), t = Math.floor(Math.random() * legal);
    if (f === t) continue;
    await tube(p, f).click();
    await tube(p, t).click();
    await p.waitForTimeout(120);
    banner = await p.evaluate(() => document.getElementById('say').classList.contains('alert'));
    if (await p.isVisible('#win')) break;
  }
  console.log('stuck warning seen:', banner, banner ? '"' + (await p.textContent('#say')) + '"' : '');
  check(banner, 'random pours on level 33 should get stuck');
  if (banner) {
    check(await p.evaluate(() => document.getElementById('undoBtn').classList.contains('pulse')), 'undo pulses');
    const before = await moves(p);
    await p.click('#undoBtn');
    check((await moves(p)) === before - 1, 'undo while stuck');
    check(!(await p.evaluate(() => document.getElementById('say').classList.contains('alert'))), 'warning clears after undo');
  }
  await p.context().close();

  // Leaving mid-pour or mid-celebration must not leak into the next screen.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const q = await ctx.newPage();
    q.on('pageerror', (e) => errors.push(String(e)));
    await q.addInitScript(() => localStorage.setItem('color-lab-v1', JSON.stringify({ unlocked: 1, sound: false })));
    await q.goto(url);
    await q.click('#playBtn');
    await q.waitForSelector('.tube.hint-from');
    await q.click('.tube.hint-from');
    await q.click('.tube.hint-to');
    await q.click('#homeBtn');
    await q.click('#playBtn');
    await q.waitForTimeout(1500);
    check((await q.locator('.tube').count()) === 3, 'level reloads cleanly after leaving mid-pour');
    // Finish level 1, then leave before the win card appears.
    for (let i = 0; i < 3; i++) {
      await q.waitForSelector('.tube.hint-from');
      await q.click('.tube.hint-from');
      await q.click('.tube.hint-to');
      await q.waitForFunction(() => !document.querySelector('.tube.pouring'));
      await q.waitForTimeout(100);
    }
    await q.click('#homeBtn');
    await q.waitForTimeout(1200);
    check(await q.isHidden('#win'), 'win card stays away after leaving');
    check(await q.isVisible('#home'), 'home screen shown');
    await ctx.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(failures ? failures + ' FAILURES' : 'all checks passed');
  process.exit(failures || errors.length ? 1 : 0);
})();
