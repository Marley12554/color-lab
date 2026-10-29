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

  // 16 big beaker, 26 mini tubes, 38 rocket boosters, 46 staircase.
  for (const level of [2, 12, 16, 26, 31, 35, 38, 46, 47, 61]) {
    const p = await open(level);
    // The worker's puzzle must match the page's own copy of the generator.
    const sol = await p.evaluate((n) => {
      const lv = window.ColorLabCore.generateLevel(n);
      return { solution: lv.solution, tubes: lv.tubes.length };
    }, level);
    check((await p.locator('.tube').count()) === sol.tubes, `level ${level} tube count`);
    check(await p.isDisabled('#restartBtn'), `level ${level} restart off before any move`);
    // One pour, then undo it.
    const [f0, t0] = sol.solution[0];
    await pour(p, f0, t0);
    check(!(await p.isDisabled('#restartBtn')), `level ${level} restart on after a pour`);
    check((await moves(p)) === 1, `level ${level} move counted`);
    await p.click('#undoBtn');
    check((await moves(p)) === 1, `level ${level} undone pour still counts`);
    check(await p.isDisabled('#undoBtn'), `level ${level} undo off with nothing to undo`);
    check(!(await p.isDisabled('#restartBtn')), `level ${level} restart stays on after undoing to the start`);
    // Undo has no limit, even on later levels where it used to be capped at 5.
    if (level === 47) {
      for (const [f, t] of sol.solution.slice(0, 8)) await pour(p, f, t);
      for (let i = 0; i < 8; i++) await p.click('#undoBtn');
      check((await moves(p)) === 9, 'eight undos in a row, every pour counted');
      check(await p.isDisabled('#undoBtn'), 'undo off after undoing everything');
    }
    // An extra tube adds one empty tube at the end and does not shift indices.
    if (level === 12) {
      await p.click('#tubeBtn');
      check((await p.locator('.tube').count()) === sol.tubes + 1, 'extra tube added');
      check(await p.isDisabled('#tubeBtn'), 'only one extra tube');
      await p.click('#hintBtn');
      await p.waitForSelector('.tube.hint-from');
      check((await p.textContent('#hintBadge')) === '2', 'hint used');
      // The arrow points at the tube to pour from first, then moves to the target.
      const arrows = () => p.evaluate(() => [...document.querySelectorAll('.tube')]
        .map((t, i) => (getComputedStyle(t, '::after').content !== 'none' ? i : -1)).filter((i) => i >= 0));
      const hintFrom = await p.evaluate(() => [...document.querySelectorAll('.tube')].findIndex((t) => t.classList.contains('hint-from')));
      const hintTo = await p.evaluate(() => [...document.querySelectorAll('.tube')].findIndex((t) => t.classList.contains('hint-to')));
      check(JSON.stringify(await arrows()) === JSON.stringify([hintFrom]), 'arrow starts on the tube to pour from');
      await tube(p, hintFrom).click();
      check(JSON.stringify(await arrows()) === JSON.stringify([hintTo]), 'arrow moves to the target after lifting');
      await tube(p, hintFrom).click();
      check(JSON.stringify(await arrows()) === JSON.stringify([hintFrom]), 'arrow goes back when put down');
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
      // A hint already paid for survives the extra tube, worked out again for free.
      await p.click('#restartBtn');
      await p.click('#hintBtn');
      await p.waitForSelector('.tube.hint-from');
      await p.click('#tubeBtn');
      await p.waitForSelector('.tube.hint-from');
      check((await p.textContent('#hintBadge')) === '2', 'extra tube keeps the paid hint');
    }
    // Restart zeroes the count. Level 31 skips it to show an undone pour
    // costing a star: one extra pour on an 8-move level.
    if (level !== 31) {
      await p.click('#restartBtn');
      check((await moves(p)) === 0, `level ${level} restart zeroes moves`);
      check(await p.isDisabled('#restartBtn'), `level ${level} restart off again after restarting`);
      if (level === 12) {
        await p.click('#tubeBtn');
        check(!(await p.isDisabled('#restartBtn')), 'restart on after using the extra tube');
      }
    }
    for (const [f, t] of sol.solution) await pour(p, f, t);
    await p.waitForSelector('#win:not([hidden])', { timeout: 5000 });
    const stars = await p.locator('#winStars i.on').count();
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('color-lab-v1')));
    console.log(`level ${level}: won in ${await moves(p)} moves, ${stars} stars, unlocked ${saved.unlocked}`);
    check(saved.unlocked === level + 1, `level ${level} unlocks the next`);
    check(level === 12 || level === 31 ? stars === 2 : stars === 3, `level ${level} stars`);
    if (level === 2) {
      // The win card can be closed to look at the finished board, or left for home.
      await p.click('#winClose');
      check(await p.isHidden('#win'), 'win card closes');
      check(await p.isVisible('#board'), 'finished board still shown');
      await p.click('#homeBtn');
      check(await p.isVisible('#home'), 'home from the finished board');
    }
    if (level === 16) {
      await p.click('#winHome');
      check(await p.isVisible('#home'), 'win card Home button');
    }
    if (level === 31) check((await p.textContent('#winStats')) === `${sol.solution.length + 1} moves (1 undone)`, 'win card counts the undone pour');
    await p.context().close();
  }

  // Make a pour the solver proves is a dead end, then check the stuck board.
  {
    const p = await open(33);
    const plan = await p.evaluate(() => {
      const C = window.ColorLabCore;
      const lv = C.generateLevel(33);
      // Search for the shortest pour sequence that ends somewhere unfinishable.
      let frontier = [{ tubes: lv.tubes, path: [] }];
      for (let depth = 0; depth < 3; depth++) {
        const next = [];
        for (const node of frontier) {
          for (let f = 0; f < node.tubes.length; f++) {
            for (let t = 0; t < node.tubes.length; t++) {
              if (!C.pourAmount(node.tubes, lv.cap, f, t)) continue;
              const after = C.cloneTubes(node.tubes);
              C.pour(after, lv.cap, f, t);
              const path = node.path.concat([[f, t]]);
              if (C.solve(after, lv.cap, { maxNodes: 1e6 }).status === 'unsolvable') {
                const rescued = after.concat([[]]);
                return { path, rescue: C.solve(rescued, lv.cap, { maxNodes: 1e6 }).status };
              }
              next.push({ tubes: after, path });
            }
          }
        }
        frontier = next;
      }
      return null;
    });
    check(!!plan, 'found a dead-end pour on level 33');
    const gray = () => p.evaluate(() => document.getElementById('board').classList.contains('stuck'));
    for (const [f, t] of plan.path) await pour(p, f, t);
    await p.waitForTimeout(400);
    check(await gray(), 'dead-end pour grays the board');
    console.log(`stuck after ${plan.path.length} pour(s): "${await p.textContent('#say')}"`);
    check(await p.evaluate(() => document.getElementById('undoBtn').classList.contains('pulse')), 'undo pulses');
    check((await p.textContent('#undoBadge')) === '1' && (await p.isVisible('#undoBadge')), 'undo button shows how many to undo');
    const said = await p.textContent('#say');
    check(/^(Dead end! This mix can't be finished\.|No pours left!) Undo 1 pour\.( Or use the extra tube\.)?$/.test(said), `warning says it plainly (${said})`);
    const before = await moves(p);
    await tube(p, 0).click();
    await tube(p, 1).click();
    check((await moves(p)) === before, 'no pours while stuck');
    check(!(await p.locator('.tube.lifted').count()), 'no tube lifts while stuck');
    // Undo back to a position that can be finished.
    for (let i = 0; i < 30 && (await gray()); i++) {
      await p.click('#undoBtn');
      await p.waitForTimeout(400);
    }
    check(!(await gray()), 'board un-grays once the mix can be finished');
    check(!(await p.isVisible('#undoBadge')), 'undo count goes away');
    check((await moves(p)) === before, 'undos keep the count');
    console.log(`  after undo: "${await p.textContent('#say')}"`);
    // Get stuck again, then see whether the extra tube rescues it.
    const [lf, lt] = plan.path[plan.path.length - 1];
    await pour(p, lf, lt);
    await p.waitForTimeout(400);
    check(await gray(), 'stuck again');
    await p.click('#tubeBtn');
    await p.waitForTimeout(400);
    check((await gray()) === (plan.rescue === 'unsolvable'), `extra tube result matches the solver (${plan.rescue})`);
    console.log(`  after extra tube: "${await p.textContent('#say')}"`);
    await p.context().close();
  }

  // Every level is open, with more labs on request and a jump-to box.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const q = await ctx.newPage();
    q.on('pageerror', (e) => errors.push(String(e)));
    await q.goto(url);
    await q.click('#levelsBtn');
    const count = () => q.locator('.level-btn').count();
    const first = await count();
    check(first >= 70, `map shows every story lab (${first})`);
    check((await q.locator('.level-btn:disabled').count()) === 0, 'no locked levels');
    await q.click('.more-labs');
    check((await count()) === first + 30, 'show more labs adds three labs');
    await q.locator('.level-btn').nth(69).click();
    await q.waitForSelector('.tube');
    check((await q.textContent('#levelTitle')).includes('70'), 'level 70 playable from a fresh start');
    await q.click('#homeBtn');
    await q.click('#levelsBtn');
    await q.fill('#jumpInput', '155');
    await q.click('#jumpForm button');
    await q.waitForSelector('.tube');
    check((await q.textContent('#levelTitle')).includes('155'), 'jump to experiment 155');
    // Custom boards make codes with a shape digit; old six-digit codes still work.
    await q.click('#homeBtn');
    await q.click('#customBtn');
    await q.click('label:has(input[value="beaker"])');
    await q.click('#mixBtn');
    await q.waitForSelector('.tube');
    const title = await q.textContent('#levelTitle');
    check(/Lab code \d{5}01-\d+/.test(title), `beaker code has shape digit 1 (${title})`);
    const tallest = await q.evaluate(() => Math.max(...[...document.querySelectorAll('.tube')].map((t) => t.offsetHeight)));
    const shortest = await q.evaluate(() => Math.min(...[...document.querySelectorAll('.tube')].map((t) => t.offsetHeight)));
    check(tallest > shortest * 1.5, 'big beaker is drawn taller');
    await q.click('#homeBtn');
    await q.click('#customBtn');
    await q.fill('#codeInput', '064220-1234');
    await q.click('#codeForm button');
    await q.waitForSelector('.tube');
    check((await q.textContent('#levelTitle')).includes('0642200-1234'), 'old code opens as a classic board');
    await ctx.close();
  }

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
