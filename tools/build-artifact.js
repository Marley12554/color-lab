// Packs the game into one self-contained HTML body (styles, scripts, and the
// worker inlined) for hosts that serve a single file, such as a claude.ai
// artifact. Usage: node tools/build-artifact.js <out.html> [--standalone]
// --standalone adds the doctype and head so the file opens on its own.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const out = process.argv[2];
const standalone = process.argv.includes('--standalone');
if (!out) {
  console.error('usage: node tools/build-artifact.js <out.html> [--standalone]');
  process.exit(1);
}

const html = read('index.html');
const body = html.split('<!-- page:start -->')[1].split('<!-- page:end -->')[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const description = html.match(/<meta name="description"[^>]+>/)[0];

// Keeps "</script>" inside inlined code from closing the tag early.
const safe = (js) => js.replace(/<\/(script)/gi, '<\\/$1');

const workerSrc = read('js/core.js') + '\n' + read('js/worker.js');
const scripts =
  '<script>window.COLOR_LAB_WORKER_SRC = ' + safe(JSON.stringify(workerSrc)) + ';</script>\n' +
  ['js/core.js', 'js/sound.js', 'js/game.js'].map((f) => '<script>\n' + safe(read(f)) + '\n</script>').join('\n');

const page = body.replace(/<script src="js\/[^"]+"><\/script>\n?/g, '').trimEnd() + '\n' + scripts + '\n';
const head = [
  '<title>Color Lab</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  description,
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  fonts,
  '<style>\n' + read('css/style.css') + '</style>',
].join('\n');

const result = standalone
  ? '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    head + '\n</head>\n<body>\n' + page + '</body>\n</html>\n'
  : head + '\n' + page;

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, result);
console.log('wrote', out, (result.length / 1024).toFixed(0) + ' KB');
