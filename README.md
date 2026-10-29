# Color Lab

A colorful sci-fi liquid sorting puzzle for kids. Tap a tube, then tap where to pour. You can pour onto the same color or into an empty tube. Finish when every tube holds one color.

There is no fixed level list. Every level is generated from its number, checked by a solver so it can always be finished, and rated for difficulty, so the levels never run out and level 47 is the same puzzle on every device.

## Play

Open `index.html` in a browser. It works straight from disk, but a web server (or GitHub Pages) is smoother because the level generator then runs in a background worker:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

To put it online with GitHub Pages: make the repository public, open **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save. The game appears at `https://<your-username>.github.io/color-lab/`.

## What's in the game

- **Campaign.** Seven labs of ten experiments each (Bubble, Spark, Comet, Rocket, Orbit, Nebula, Galaxy), then endless labs after that. Every level is open from the start; the level map has a "Go to experiment" box and shows more endless labs on request. New ideas arrive one at a time: the big beaker at 16, taller tubes at 21, mini tubes at 26, one empty tube at 31, mystery layers at 35, rocket boosters at 38, the tallest tubes at 45, the staircase at 46. Each lab has a couple of easier "breather" levels.
- **Special boards.** Every lab after the first has at least one, marked with a striped corner on the map:
  - *Big beaker:* a beaker twice as tall as a tube stands in the middle across both rows, with one regular empty tube.
  - *Rocket boosters:* a booster tube nearly twice as tall at each end, both starting full of mixed colors.
  - *Mini tubes:* the free space comes as several small tubes. A small tube can't hold a finished color, so it has to end up empty.
  - *Staircase:* tubes step up in height. The short one has to end up empty; the tall ones have a layer to spare.
- **Mix your own.** Pick a board (classic or any special board), colors (2 to 12), tube size (3 to 6), empty tubes (1 to 3, classic board only), challenge (Easy, Medium, Hard, Genius), and mystery layers. Every mix gets a lab code like `0842200-4821` that friends can type in to play the same puzzle. Older six-digit codes still work and mean the classic board.
- **Help.** Unlimited undo, plus 3 hints from the solver and 1 extra empty tube per level. Restart refills the hints and the tube. Using a hint or the extra tube caps a level at 2 stars.
- **Stars.** 3 stars for matching or beating the robot's move count, 2 stars within 40% of it, 1 star for finishing. Every pour counts, including ones you undo; Restart starts the count over.
- **Dead-end warning.** After each pour the solver quietly tries every way forward. If none of them can be finished, the robot says so in plain words ("Dead end! This mix can't be finished. Undo 1 pour."), even when some pours are still possible, and adds "Or use the extra tube." when that would rescue it. The tubes turn gray and stop taking pours, the Undo button shows the number to undo, and the board stays gray until you're back at a mix that can be finished.
- **Color shapes.** An option that marks every color with its own shape, for color-blind players.
- Sounds are synthesized in the browser (no audio files). Progress is saved in the browser.

## How levels are made

`js/core.js` holds everything that is not drawing:

1. **Deal.** Shuffle `colors × height` layers into tubes from a seeded random number generator, plus the empty tubes. Deals where a tube starts finished or nearly finished are skipped.
2. **Solve.** A best-first search over tube states (tubes are sorted before comparing, since their order doesn't matter) proves the deal can be finished, or proves it can't. With weight 1 it is exact A* and finds the shortest solution; the tests check it against brute force on 300 small puzzles.
3. **Rate.** Two numbers: how often a pretend player who never plans ahead gets stuck (the "trap rate"), and how much backtracking the solver needed per move. The first separates small and medium puzzles; the second separates big ones, where almost every pretend player gets stuck.
4. **Pick.** Collect several solvable deals, sort them by rating, and take the one at the requested spot (0 is the easiest of the batch, 1 the hardest).

Size does most of the difficulty work; the pick chooses easy or tricky deals within a size. Every budget counts search steps rather than time, so slow and fast devices produce identical puzzles.

Special boards are described by each tube's height plus how many layers make a finished color, and the solver, rules, and tests all work on any mix of heights. Every board keeps at least one more tube that can hold a finished color than there are colors; without that spare, most deals can't be finished at all.

With only one empty tube most deals can't be finished, so big ones take too long to find. The game caps them: with one empty tube, at most 12 colors in 3-layer tubes, 9 in 4-layer, 7 in 5-layer, and 6 in 6-layer.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html` | Page markup |
| `css/style.css` | All styles |
| `js/core.js` | Rules, solver, difficulty rating, generator, campaign table. No DOM; runs in the page, the worker, and Node. |
| `js/worker.js` | Runs generation and solving off the main thread |
| `js/game.js` | Screens, tube board, pouring animation, tools, progress |
| `js/sound.js` | Web Audio sound effects |
| `test/core.test.js` | Unit tests for the rules, solver, and generator |
| `tools/` | Benchmarks, the campaign report, browser play-tests, and the single-file build |

## Development

```bash
npm test
```

Runs the unit tests (Node 18 or newer, no dependencies).

```bash
node tools/campaign.js 1 90
```

Prints every campaign level's size, rating, and generation time. Change the `LABS` table in `js/core.js` to retune the curve.

```bash
node tools/shapes.js
```

Shows, for each special board, how many random deals can be finished and how long one takes to find.

```bash
node tools/playtest.js http://localhost:8000/index.html
```

Plays whole levels through the real page in headless Chromium (including one of each special board) and checks undo, hints, the extra tube, stars, the dead-end warning, the level map, and lab codes. This one and `tools/shoot.js` (screenshots) need Playwright.

```bash
node tools/build-artifact.js dist/color-lab.html --standalone
```

Packs the whole game into one HTML file.
