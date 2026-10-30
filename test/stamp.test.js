const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('version stamp matches the current files', () => {
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'stamp.js'), '--check'], { stdio: 'pipe' })
  );
});
