export const suite = {
  queue: [],
  passed: 0,
  failed: 0,
  tests: []
};

export default function test(name, fn) {
  suite.queue.push({ name, fn });
}

export async function runAllTests() {
  for (const { name, fn } of suite.queue) {
    try {
      await fn();
      suite.passed++;
      suite.tests.push({ name, status: 'PASS' });
    } catch (err) {
      suite.failed++;
      suite.tests.push({ name, status: 'FAIL', error: err.message, stack: err.stack });
    }
  }
  return suite;
}

