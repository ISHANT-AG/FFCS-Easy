import test from 'node:test';
import assert from 'node:assert/strict';
import { startGeneration } from '../src/generation.js';
class WorkerDouble {
  terminated = false;
  postMessage(p) {
    this.payload = p;
  }
  terminate() {
    this.terminated = true;
  }
  send(data) {
    this.onmessage({ data });
  }
}
test('progress messages do not finish generation; final result stops worker', () => {
  const w = new WorkerDouble(),
    progress = [],
    results = [];
  startGeneration(
    { id: 7 },
    { createWorker: () => w, onProgress: (p) => progress.push(p), onResult: (r) => results.push(r) }
  );
  w.send({ id: 7, progress: { found: 2 } });
  assert.equal(results.length, 0);
  assert.equal(w.terminated, false);
  w.send({ id: 6, results: [] });
  assert.equal(results.length, 0);
  w.send({ id: 7, results: [{ signature: 'A' }] });
  assert.equal(results.length, 1);
  assert.equal(w.terminated, true);
  w.send({ id: 7, results: [] });
  assert.equal(results.length, 1);
  assert.equal(progress.length, 1);
});
test('a silent or hung worker times out and returns a retryable result', async () => {
  const w = new WorkerDouble();
  const r = await new Promise((resolve) =>
    startGeneration({ id: 1 }, { createWorker: () => w, onResult: resolve, timeoutMs: 15 })
  );
  assert.equal(w.terminated, true);
  assert.deepEqual(r.results, []);
  assert.match(r.reason, /too long/);
});
test('cancellation discards late results', () => {
  const w = new WorkerDouble(),
    results = [];
  const run = startGeneration(
    { id: 1 },
    { createWorker: () => w, onResult: (r) => results.push(r) }
  );
  run.terminate();
  w.send({ id: 1, results: [{}] });
  assert.equal(w.terminated, true);
  assert.equal(results.length, 0);
});
test('startup errors and worker failures leave loading with a useful error', () => {
  let r;
  startGeneration(
    { id: 1 },
    {
      createWorker: () => {
        throw Error('No worker');
      },
      onResult: (data) => (r = data),
    }
  );
  assert.match(r.reason, /Could not start/);
  const w = new WorkerDouble();
  startGeneration({ id: 2 }, { createWorker: () => w, onResult: (data) => (r = data) });
  w.onerror();
  assert.match(r.reason, /Could not finish/);
  assert.equal(w.terminated, true);
});
