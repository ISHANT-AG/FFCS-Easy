function format(val) {
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

export function ok(val, msg) {
  if (!val) throw new Error(msg || `Expected truthy, got ${format(val)}`);
}

export function equal(actual, expected, msg) {
  if (actual != expected) {
    throw new Error(msg || `Expected ${format(expected)}, got ${format(actual)}`);
  }
}

export function strictEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${format(expected)}, got ${format(actual)}`);
  }
}

export function notEqual(actual, expected, msg) {
  if (actual == expected) {
    throw new Error(msg || `Expected not equal to ${format(expected)}`);
  }
}

export function notStrictEqual(actual, expected, msg) {
  if (actual === expected) {
    throw new Error(msg || `Expected not strictly equal to ${format(expected)}`);
  }
}

export function deepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(msg || `deepEqual failed.\nExpected: ${e}\nActual: ${a}`);
  }
}

export function throws(fn, msg) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(msg || 'Expected function to throw');
}

export function match(val, regex, msg) {
  if (!regex.test(String(val))) throw new Error(msg || `Expected ${val} to match ${regex}`);
}

export default {
  ok,
  equal,
  strictEqual,
  notEqual,
  notStrictEqual,
  deepEqual,
  throws,
  match,
};
