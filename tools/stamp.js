// Stamps a version on the page's script and style links (and the worker's)
// so browsers fetch fresh files after each change instead of reusing cached
// ones. The version is a hash of the files themselves, so it only changes
// when they do. Usage: node tools/stamp.js [--check]
// --check exits with an error if the stamp is out of date, without writing.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const unstamp = (text) => text.replace(/\?v=[0-9a-f]+/g, '');

const assets = ['css/style.css', 'js/core.js', 'js/sound.js', 'js/game.js', 'js/worker.js'];
const hash = crypto.createHash('sha1');
assets.forEach((p) => hash.update(unstamp(read(p))));
const v = hash.digest('hex').slice(0, 10);

const targets = {
  'index.html': (t) => t.replace(/(href="css\/style\.css|src="js\/\w+\.js)(\?v=[0-9a-f]+)?"/g, '$1?v=' + v + '"'),
  'js/game.js': (t) => t.replace(/'js\/worker\.js(\?v=[0-9a-f]+)?'/, "'js/worker.js?v=" + v + "'"),
  'js/worker.js': (t) => t.replace(/'core\.js(\?v=[0-9a-f]+)?'/, "'core.js?v=" + v + "'"),
};

const stale = [];
for (const [file, stamp] of Object.entries(targets)) {
  const before = read(file);
  const after = stamp(before);
  if (after === before) continue;
  stale.push(file);
  if (!process.argv.includes('--check')) fs.writeFileSync(path.join(root, file), after);
}
if (process.argv.includes('--check')) {
  if (stale.length) {
    console.error('Version stamp is out of date in ' + stale.join(', ') + '. Run: node tools/stamp.js');
    process.exit(1);
  }
  console.log('stamp ' + v + ' is current');
} else console.log('stamped ' + v + (stale.length ? ' in ' + stale.join(', ') : ' (no changes)'));
