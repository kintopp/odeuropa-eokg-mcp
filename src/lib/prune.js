// Recursively drop empty values ('', null, undefined, [], {}) to keep shaper
// payloads token-frugal, while never touching `false`/`0`. Shared by the
// record shapers (record.js, detail.js); callers re-attach any keys they
// guarantee (e.g. `id`) after pruning.
export function prune(value) {
  if (Array.isArray(value)) {
    const arr = value.map(prune).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const p = prune(v);
      if (p !== undefined) out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === '' || value === null || value === undefined) return undefined;
  return value;
}
