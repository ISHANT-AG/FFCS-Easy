import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
test('app modules parse before the UI can be deployed', () => {
  for (const file of readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', new URL('src/' + file, root).pathname], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, file + ': ' + r.stderr);
  }
});
test('entry, dependencies and worker share one asset version', () => {
  const index = readFileSync(new URL('index.html', root), 'utf8');
  const version = index.match(/src\/bootstrap\.js\?v=([a-f0-9]+)/)?.[1];
  assert.ok(version);
  assert.ok(index.includes('style.css?v=' + version));
  for (const file of readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(new URL('src/' + file, root), 'utf8');
    for (const match of source.matchAll(/['"](\.\.?\/[^'"\n]+\.js)(\?v=[a-f0-9]+)?['"]/g))
      assert.equal(match[2], '?v=' + version, file + ' ' + match[1]);
  }
});
test('new course-status export exists in the versioned sections module', async () => {
  const { getCourseStatus } = await import('../src/sections.js');
  assert.equal(getCourseStatus({ scheduled: false, sections: [] }).isReady, true);
});
