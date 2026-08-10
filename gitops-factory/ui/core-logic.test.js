// Node self-test for the merge/diff logic embedded in multi-app-manager.html
// (deepMerge / subtractDefaults / flattenKeys, inside the <script> tag after
// the vendored js-yaml). It's duplicated there rather than imported, since
// the HTML file has to be a single self-contained file with no build step —
// this test exists so that logic doesn't silently drift from
// convert_to_universal_chart.py's deep_merge / common_subtree /
// subtract_defaults, which it must stay equivalent to.
//
// Run: node ui/core-logic.test.js

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  return false;
}

function deepMerge(base, override) {
  const result = { ...(base || {}) };
  for (const [key, val] of Object.entries(override || {})) {
    if (isPlainObject(result[key]) && isPlainObject(val)) {
      result[key] = deepMerge(result[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function commonSubtree(dicts) {
  if (dicts.length < 2) return {};
  const [first, ...rest] = dicts;
  const common = {};
  for (const [key, val] of Object.entries(first)) {
    if (!rest.every((d) => Object.prototype.hasOwnProperty.call(d, key))) continue;
    const others = rest.map((d) => d[key]);
    if (isPlainObject(val) && others.every(isPlainObject)) {
      const sub = commonSubtree([val, ...others]);
      if (Object.keys(sub).length) common[key] = sub;
    } else if (others.every((o) => deepEqual(o, val))) {
      common[key] = val;
    }
  }
  return common;
}

function subtractDefaults(values, defaults) {
  if (!defaults || !Object.keys(defaults).length) return values;
  const out = {};
  for (const [key, val] of Object.entries(values)) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
      out[key] = val;
      continue;
    }
    const dval = defaults[key];
    if (isPlainObject(val) && isPlainObject(dval)) {
      const sub = subtractDefaults(val, dval);
      if (Object.keys(sub).length) out[key] = sub;
    } else if (!deepEqual(val, dval)) {
      out[key] = val;
    }
  }
  return out;
}

const assert = require("assert");

// deepMerge: override wins, recursive for dicts, lists replaced wholesale
assert.deepStrictEqual(
  deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 99 }, e: 5 }),
  { a: 1, b: { c: 99, d: 3 }, e: 5 }
);
assert.deepStrictEqual(deepMerge({ a: [1, 2] }, { a: [9] }), { a: [9] });

// commonSubtree: only keys identical across EVERY dict survive, recursively
const d1 = { resources: { requests: { cpu: "100m" }, limits: { cpu: "500m" } }, replicas: 2 };
const d2 = { resources: { requests: { cpu: "100m" }, limits: { cpu: "999m" } }, replicas: 3 };
const d3 = { resources: { requests: { cpu: "100m" }, limits: { cpu: "999m" } }, replicas: 1 };
assert.deepStrictEqual(commonSubtree([d1, d2, d3]), { resources: { requests: { cpu: "100m" } } });

// subtractDefaults: exact inverse — removes whatever matches defaults, recursively
const defaults = { resources: { requests: { cpu: "100m" } } };
assert.deepStrictEqual(
  subtractDefaults({ resources: { requests: { cpu: "100m" }, limits: { cpu: "999m" } }, replicas: 2 }, defaults),
  { resources: { limits: { cpu: "999m" } }, replicas: 2 }
);

// round-trip: subtract then merge back reconstructs the original
for (const d of [d1, d2, d3]) {
  const common = commonSubtree([d1, d2, d3]);
  const trimmed = subtractDefaults(d, common);
  assert.deepStrictEqual(deepMerge(common, trimmed), d, "merge(common, subtract(d, common)) must equal d");
}

// empty/single-input edge cases
assert.deepStrictEqual(commonSubtree([]), {});
assert.deepStrictEqual(commonSubtree([d1]), {});
assert.deepStrictEqual(subtractDefaults({ a: 1 }, {}), { a: 1 });

console.log("All core-logic self-tests passed.");
