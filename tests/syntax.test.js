import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:vm';
import { execSync } from 'node:child_process';

test('Application entry point and source syntax verification', () => {
  const files = [
    'src/app.js',
    'src/engine.js',
    'src/generation.js',
    'src/pdf-export.js',
    'src/pdf-text.js',
    'src/portal.js',
    'src/sections.js',
    'src/uploads.js',
    'src/worker.js',
  ];

  for (const f of files) {
    try {
      execSync(`node -c ${f}`, { stdio: 'pipe' });
      assert.ok(true, `${f} syntax valid`);
    } catch (err) {
      assert.fail(`Syntax error detected in ${f}: ${err.message}`);
    }
  }
});
