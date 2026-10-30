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
    // Level 31 finishes one pour over the robot's count, inside the 3-star leeway.
    check(level === 12 ? stars === 2 : stars === 3, `level ${level} stars`);
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
    // Giant Tubes from Mix your own: the code carries the mode, and the giant
    // tube is drawn taller and starts packed.
    await q.click('#homeBtn');
    await q.click('#customBtn');
    await q.click('label:has(#modeGiant)');
    await q.click('#mixBtn');
    await q.waitForSelector('.tube');
    const title = await q.textContent('#levelTitle');
    check(/Lab code \d{6}10-\d+/.test(title), `giant code has giant digit 1 (${title})`);
    const heights = await q.evaluate(() => [...document.querySelectorAll('.tube')].map((t) => t.offsetHeight));
    check(Math.max(...heights) > Math.min(...heights) * 1.5, 'giant tube is drawn taller');
    // Labeled Tubes: a labeled tube refuses other colors and says so.
    await q.click('#homeBtn');
    await q.click('#customBtn');
    await q.click('label:has(#modeGiant)');
    await q.click('label:has(#modeLabels)');
    await q.click('#mixBtn');
    await q.waitForSelector('.tube.labeled');
    const refusal = await q.evaluate(() => {
      const tubes = [...document.querySelectorAll('.tube')];
      const labeled = tubes.findIndex((t) => t.classList.contains('labeled'));
      const label = getComputedStyle(tubes[labeled]).getPropertyValue('--label').trim();
      // Find a tube whose top color differs from the label.
      const from = tubes.findIndex((t) => {
        const top = t.querySelector('.liquid .seg:last-child');
        return top && getComputedStyle(top).getPropertyValue('--c').trim() !== label;
      });
      return { labeled, from };
    });
    await q.locator('.tube').nth(refusal.from).click();
    await q.locator('.tube').nth(refusal.labeled).click();
    const said = await q.textContent('#say');
    check(/^That tube only takes [a-z ]+!$/.test(said), `labeled tube refuses other colors (${said})`);
    check((await moves(q)) === 0, 'refused pour does not count');
    // Presets: one tap sets every setting and lights its card; changing a
    // setting after that shows Custom and keeps the rest, trickiness included.
    await q.click('#homeBtn');
    await q.click('#customBtn');
    await q.click('.preset[data-preset="genius"]');
    check((await q.getAttribute('.preset[data-preset="genius"]', 'aria-pressed')) === 'true', 'Genius card lights up');
    check((await q.textContent('#colorsOut')) === '12' && (await q.textContent('#capOut')) === '5', 'Genius sets the board size');
    check(await q.isChecked('#modeLabels') && await q.isChecked('#mysteryToggle'), 'Genius turns on its modes');
    check(await q.isHidden('#customBadge'), 'no Custom badge while a preset matches');
    await q.click('.stepper[data-key="empties"] [data-step="1"]');
    check(await q.isVisible('#customBadge'), 'changing a setting shows Custom');
    check((await q.locator('.preset[aria-pressed="true"]').count()) === 0, 'no preset lit once changed');
    check(await q.isChecked('input[name="trick"][value="2"]'), 'trickiness stays where it was');
    await q.click('.preset[data-preset="hard"]');
    const hardModes = await q.evaluate(() => ['modeGiant', 'modeLabels', 'mysteryToggle'].filter((id) => document.getElementById(id).checked));
    check(hardModes.length === 1, `Hard adds one surprise mode (${hardModes})`);
    await q.click('.preset[data-preset="genius"]');
    await q.click('.stepper[data-key="empties"] [data-step="1"]');
    await q.click('#mixBtn');
    await q.waitForSelector('.tube', { timeout: 20000 });
    const code = await q.textContent('#levelTitle');
    check(code.includes('12532102-'), `code carries the settings and trickiness (${code})`);
    // Giant Tubes with Mini Tubes: both stay on, within their limits, and the
    // board has a giant tube and small ones.
    await q.click('#homeBtn');
    await q.click('#customBtn');
    await q.click('.preset[data-preset="genius"]');
    await q.click('label:has(#modeLabels)');
    await q.click('label:has(#mysteryToggle)');
    await q.click('label:has(#modeGiant)');
    await q.click('label:has(#modeMinis)');
    check(await q.isChecked('#modeGiant') && await q.isChecked('#modeMinis'), 'Giant and Mini Tubes stay on together');
    check(await q.isDisabled('input[name="giants"][value="2"]'), 'two giant tubes are off with Mini Tubes');
    const lim = await q.evaluate(() => ['colorsOut', 'capOut', 'emptiesOut'].map((id) => +document.getElementById(id).textContent));
    check(lim[0] <= 8 && lim[1] <= 5 && lim[2] === 2, `Giant + Mini limits apply (${lim})`);
    check((await q.textContent('#sizeNote')).includes('Giant Tubes with Mini Tubes'), 'Giant + Mini explains its limits');
    await q.click('#mixBtn');
    await q.waitForSelector('.tube', { timeout: 20000 });
    const gm = await q.evaluate(() => {
      const hs = [...document.querySelectorAll('.tube')].map((t) => t.offsetHeight);
      const sorted = [...new Set(hs)].sort((a, b) => a - b);
      return { kinds: sorted.length, max: Math.max(...hs), min: Math.min(...hs) };
    });
    check(gm.kinds >= 3 && gm.max > gm.min * 2, `board has giant, regular, and small tubes (${JSON.stringify(gm)})`);
    // A middle giant tube splits the board into two matching groups.
    const sym = await q.evaluate(() => {
      const board = document.getElementById('board').getBoundingClientRect();
      const tubes = [...document.querySelectorAll('.tube')].map((t) => t.getBoundingClientRect());
      const giant = tubes.reduce((a, t) => (t.height > a.height ? t : a));
      const left = tubes.filter((t) => t.right <= giant.left).length;
      const right = tubes.filter((t) => t.left >= giant.right).length;
      return { offset: Math.abs(giant.left + giant.width / 2 - (board.left + board.width / 2)), left, right };
    });
    check(sym.offset < 2 && Math.abs(sym.left - sym.right) <= 1, `giant tube in the middle of matching groups (${JSON.stringify(sym)})`);
    // Codes from before trickiness are turned away.
    await q.click('#homeBtn');
    await q.click('#customBtn');
    await q.fill('#codeInput', '064220-1234');
    await q.click('#codeForm button');
    check((await q.textContent('#codeError')).includes('older version'), 'old code explains itself');
    await q.fill('#codeInput', '06423010-1234');
    await q.click('#codeForm button');
    check((await q.textContent('#codeError')).includes('does not look right'), 'trickiness above 2 is rejected');
    await ctx.close();
  }

  // Pause and resume, and boards that differ from mix to mix.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const q = await ctx.newPage();
    q.on('pageerror', (e) => errors.push(String(e)));
    await q.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('color-lab-v1', JSON.stringify({ unlocked: 5, sound: false }));
      }
    });
    await q.goto(url);
    const labels = () => q.evaluate(() => [...document.querySelectorAll('.tube')].map((t) => t.getAttribute('aria-label')).join('|'));
    // Two pours on level 5, then home: Play says resume and brings it back.
    await q.click('#playBtn');
    await q.waitForSelector('.tube');
    const sol = await q.evaluate(() => window.ColorLabCore.generateLevel(5).solution);
    for (const [f, t] of sol.slice(0, 2)) await pour(q, f, t);
    const before = await labels();
    await q.click('#homeBtn');
    check((await q.textContent('#playSub')).includes('resume'), 'Play offers to resume level 5');
    await q.reload();
    await q.click('#levelsBtn');
    await q.locator('.level-btn').nth(4).click();
    await q.waitForSelector('.tube');
    check((await moves(q)) === 2 && (await labels()) === before, 'level 5 resumes from the map after a reload');
    // A mix in progress shows a Resume button on the home screen.
    await q.click('#homeBtn');
    await q.click('#customBtn');
    await q.click('#mixBtn');
    await q.waitForSelector('.tube');
    const mixSol = await q.evaluate(() => {
      const C = window.ColorLabCore;
      const tubes = [...document.querySelectorAll('.tube')];
      return tubes.length;
    });
    await q.locator('.tube').nth(0).click();
    await q.locator('.tube').nth(mixSol - 1).click();
    const mixMoves = await moves(q);
    const mixBefore = await labels();
    await q.click('#homeBtn');
    check(await q.isVisible('#resumeBtn'), 'Resume button for a mix in progress');
    await q.click('#resumeBtn');
    await q.waitForSelector('.tube');
    check((await moves(q)) === mixMoves && (await labels()) === mixBefore, 'mix resumes where it was');
    // Same settings, different layouts.
    const shapes = new Set();
    for (let i = 0; i < 4; i++) {
      await q.click('#homeBtn');
      await q.click('#customBtn');
      await q.click('#mixBtn');
      await q.waitForSelector('.tube');
      shapes.add(await q.evaluate(() => [...document.querySelectorAll('.tube')].map((t) => (t.querySelector('.seg') ? 'x' : 'o')).join('')));
    }
    check(shapes.size > 1, `mixes with the same settings differ in layout (${[...shapes].join(' ')})`);
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
    check((await moves(q)) === 1, 'the pour made before leaving is kept');
    // Finish level 1, then leave before the win card appears.
    for (let i = 0; i < 3; i++) {
      await q.waitForSelector('.tube.hint-from');
      await q.click('.tube.hint-from');
      await q.click('.tube.hint-to');
      await q.waitForFunction(() => !document.querySelector('.tube.pouring'));
      await q.waitForTimeout(100);
      if ((await q.textContent('#say')).startsWith('Experiment complete')) break;
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
