// Size budgeting for tool results.

export function truncateText(s, max) {
  return s.length > max ? `${s.slice(0, max)} …` : s;
}

const jsonLen = (o) => JSON.stringify(o).length;

/**
 * Trim each listed array field of `obj` (in order) by binary search until
 * JSON.stringify(obj).length <= budget. Records `truncated: { [field]: originalLength }`
 * for every cut field, counted toward the budget. Trimmed-to-nothing fields stay `[]`.
 * Returns a new object; an object already under budget comes back unchanged.
 */
export function capArrays(obj, fields, budget) {
  if (jsonLen(obj) <= budget) return obj;
  const out = { ...obj };
  for (const field of fields) {
    if (jsonLen(out) <= budget) break;
    const original = out[field];
    if (!Array.isArray(original) || !original.length) continue;
    // Record the cut before measuring so its bytes count toward the budget.
    out.truncated = { ...out.truncated, [field]: original.length };
    let lo = 0;
    let hi = original.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      out[field] = original.slice(0, mid);
      if (jsonLen(out) <= budget) lo = mid;
      else hi = mid - 1;
    }
    out[field] = original.slice(0, lo);
    if (lo === original.length) {
      delete out.truncated[field];
      if (!Object.keys(out.truncated).length) delete out.truncated;
    }
  }
  return out;
}
