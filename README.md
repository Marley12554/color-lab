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

- **Campaign.** Seven labs of ten experiments each (Bubble, Spark, Comet, Rocket, Orbit, Nebula, Galaxy), then endless labs after that. Every level is open from the start; the level map has a "Go to experiment" box and shows more endless labs on request. New ideas arrive one at a time: a giant tube at 16, taller tubes at 21, mini tubes at 26, one empty tube at 31, mystery layers at 35, labeled tubes at 38, the tallest tubes at 45, two giant tubes at 46, and from 56 on some levels mix two modes. Each lab has a couple of easier "breather" levels.
- **Modes.** Each one changes the rules, not just the look, and they stack. Levels with a board mode get a striped corner on the map.
  - *Giant Tubes:* one or two tubes twice as tall, packed full of mixed colors at the start. For each giant tube one color has twice as many layers, and it finishes by filling a giant tube all the way up. A packed giant tube has to be dug out somewhere, so each giant tube needs one more empty tube than usual (1 giant tube: at least 2 empty tubes; 2 giant tubes: at least 3). Giant tubes stand in the middle, at both ends, or side by side on one side.
  - *Mini Tubes:* your spare room comes as small tubes that hold 2 or 3 layers. A small tube can't hold a finished color, so it has to end up empty.
  - *Labeled Tubes:* one to three tubes start empty and take only their own color. They wear a white label wrapped around the glass with a dot of their color (holding its shape when color shapes are on), and the glass is tinted that color. Each must end up holding its color.
  - *Mystery Layers:* lower layers stay hidden until they're uncovered.
  Boards vary from deal to deal within the same settings: where each tube stands, where giant tubes go, how many tubes are labeled, and the mix of small tube sizes. Giant Tubes and Mini Tubes can't be combined yet: digging a packed giant tube out into small tubes alone makes boards that take far too long to generate. The generator rejects puzzles where a mode makes no difference: without the mini tubes the puzzle must be impossible (or, with labels too, the solver's route must use them), and the solver's route with the labels ignored must break them. Giant tubes always matter, since they start full and hold the big colors.
- **Mix your own.** Tap a preset to set everything at once, or set things one by one.
  - *Presets:* Easy (5 colors, size 4), Medium (8 colors, size 4), Hard (10 colors, size 5, one surprise mode: giant, labeled, or mystery; tap again for a different one), and Genius (12 colors, size 5, labeled and mystery). Each card shows a tiny picture of the board it makes, and the settings it changes light up. A card stays lit only while every setting matches it; change anything and the settings show *Custom*.
  - *Settings:* colors (2 to 12), tube size (3 to 6), empty tubes (1 to 3: the board's budget of free room, which labeled and small tubes count against; giant tubes need extra finishing tubes, so they add the minimum the rules require), trickiness, and any mix of modes. Mini Tubes and Labeled Tubes together allow up to 8 colors, since checking those boards for fairness is slow.
  - *Trickiness* (Gentle, Normal, Sneaky) doesn't change the board's size or rules. The generator deals several fair puzzles at your settings and gives you the easiest, one from the middle, or the hardest to sort. It matters most on smaller boards: at 6 colors in 4-layer tubes, a player who doesn't plan ahead gets stuck on about 3% of Gentle puzzles and 44% of Sneaky ones.
  - *Lab codes:* every mix gets a code like `08421000-4821` (colors, size, empty tubes, trickiness, mystery, giant tubes, then mini + 2 x labeled) that friends can type in to play the same puzzle. Codes from before trickiness are turned away.
- **Help.** Unlimited undo, plus 3 hints from the solver and 1 extra empty tube per level. Restart refills the hints and the tube. Using a hint or the extra tube caps a level at 2 stars.
- **Pause and resume.** Your current run is saved after every pour, so you can leave for the home screen, the level map, or another tab (or close the page) and pick it up again with Resume, or by opening that level again. Winning clears it; starting a different level or a new mix replaces it.
- **Stars.** 3 stars for finishing within 12.5% of the robot's move count (no leeway on tiny puzzles: 41 robot moves allow 46), 2 stars within 1.5 times it, 1 star for finishing. Every pour counts, including ones you undo; Restart starts the count over.
- **Dead-end warning.** After each pour the solver quietly tries every way forward. If none of them can be finished, the robot says so in plain words ("Dead end! This mix can't be finished. Undo 1 pour."), even when some pours are still possible, and adds "Or use the extra tube." when that would rescue it. The tubes turn gray and stop taking pours, the Undo button shows the number to undo, and the board stays gray until you're back at a mix that can be finished.
- **Color shapes.** An option that marks every color with its own shape, for color-blind players.
- Sounds are synthesized in the browser (no audio files): taps on every button, a soft pop when the mouse moves onto one, a jingle when a level starts, and pour, seal, and win sounds. Browsers block sound until the first tap, so the game is silent until then. Progress is saved in the browser.

## How levels are made

`js/core.js` holds everything that is not drawing:

1. **Deal.** Shuffle `colors × height` layers into tubes from a seeded random number generator, plus the empty tubes. Deals where a tube starts finished or nearly finished are skipped.
2. **Solve.** A best-first search over tube states (tubes are sorted before comparing, since their order doesn't matter) proves the deal can be finished, or proves it can't. With weight 1 it is exact A* and finds the shortest solution; the tests check it against brute force on 300 small puzzles.
3. **Check it's fair.** Walking along the solver's route, count how many of the pours on offer at each step lead straight into a dead end. A puzzle is fair when that's at most 10% overall and never more than half at any one moment. Every level and every trickiness, Sneaky included, only picks from fair puzzles, so hard means bigger and more planning, not guessing which pour is a trap. (With one empty tube from about six colors up, fair puzzles almost never come up, so the campaign avoids those sizes, and Mix your own warns that one empty tube means more dead ends.)
4. **Rate.** Two numbers: how often a pretend player who never plans ahead gets stuck (the "trap rate"), and how much backtracking the solver needed per move. The first separates small and medium puzzles; the second separates big ones, where almost every pretend player gets stuck.
5. **Pick.** Collect several solvable deals, sort them by rating, and take the one at the requested spot (0 is the easiest of the batch, 1 the hardest).

Size does most of the difficulty work; the pick chooses easy or tricky deals within a size. Every budget counts search steps rather than time, so slow and fast devices produce identical puzzles.

A board is described by each tube's height, its label (the only color it takes, if any), and how many layers make a finished color; the rules, solver, and tests all work on any mix of these. Every board keeps enough tubes that can hold a finished color, plus one spare unless the spare room is all mini tubes; without that, most deals can't be finished at all.

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
node tools/deadends.js 1 70
```

Shows, for each campaign level, the share of pours along a good route that lead straight into a dead end.

```bash
node tools/modes.js 12 6
```

Times the generator on the biggest custom mixes for each combination of modes and checks the results are fair.

```bash
node tools/playtest.js http://localhost:8000/index.html
```

Plays whole levels through the real page in headless Chromium (including one of each special board) and checks undo, hints, the extra tube, stars, the dead-end warning, the level map, and lab codes. This one and `tools/shoot.js` (screenshots) need Playwright.

```bash
node tools/build-artifact.js dist/color-lab.html --standalone
```

Packs the whole game into one HTML file.
