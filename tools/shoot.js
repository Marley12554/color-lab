// Drives the game in headless Chromium: plays level 1, visits screens, saves screenshots.
const { chromium } = require('playwright');
const out = process.argv[2];
const url = process.argv[3] || 'http://localhost:8765/index.html';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function page(viewport, state) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    p.on('pageerror', (e) => errors.push(String(e)));
    if (state) await p.addInitScript((s) => localStorage.setItem('color-lab-v1', JSON.stringify(s)), state);
    await p.goto(url);
    await p.waitForTimeout(600);
    return p;
  }
  const phone = { width: 390, height: 844 };
  let p = await page(phone);
  await p.screenshot({ path: `${out}/1-home.png` });
  await p.click('#playBtn');
  await p.waitForSelector('.tube');
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/2-level1.png` });
  // Play level 1 by following the solver's hint each move.
  for (let i = 0; i < 6; i++) {
    const done = await p.evaluate(() => !document.getElementById('win').hidden);
    if (done) break;
    await p.waitForSelector('.tube.hint-from, #win:not([hidden])', { timeout: 4000 });
    if (await p.evaluate(() => !document.getElementById('win').hidden)) break;
    const from = await p.$('.tube.hint-from');
    const to = await p.$('.tube.hint-to');
    await from.click();
    await p.waitForTimeout(150);
    if (i === 0) await p.screenshot({ path: `${out}/3-lifted.png` });
    await to.click();
    if (i === 0) { await p.waitForTimeout(560); await p.screenshot({ path: `${out}/4-pouring.png` }); }
    await p.waitForTimeout(1500);
  }
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/5-win.png` });
  await p.close();

  // A later level with lots of tubes, on a phone.
  const progress = { unlocked: 70, stars: { 1: 3, 2: 2, 3: 1 }, best: {}, sound: false, shapes: false };
  p = await page(phone, progress);
  await p.click('#levelsBtn');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/6-levels.png` });
  await p.close();
  p = await page(phone, progress);
  await p.click('#playBtn');
  await p.waitForSelector('.tube');
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/7-level70.png` });
  await p.close();

  // Mystery level, color shapes on, desktop.
  p = await page({ width: 1280, height: 800 }, { ...progress, unlocked: 35, shapes: true });
  await p.click('#playBtn');
  await p.waitForSelector('.tube');
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/8-mystery-desktop.png` });
  await p.close();

  p = await page(phone);
  await p.click('#customBtn');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/9-custom.png` });
  await p.close();

  // Get stuck on purpose to see the warning.
  p = await page(phone, { ...progress, unlocked: 33 });
  await p.click('#playBtn');
  await p.waitForSelector('.tube');
  for (let i = 0; i < 120; i++) {
    if (await p.evaluate(() => document.getElementById('say').classList.contains('alert'))) break;
    const n = await p.locator('.tube').count();
    const f = Math.floor(Math.random() * n), t = Math.floor(Math.random() * n);
    if (f === t) continue;
    await p.locator('.tube').nth(f).click();
    await p.locator('.tube').nth(t).click();
    await p.waitForFunction(() => !document.querySelector('.tube.pouring'));
    await p.waitForTimeout(150);
  }
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/10-stuck.png` });
  await p.close();

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
