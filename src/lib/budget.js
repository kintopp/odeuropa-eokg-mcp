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

/**
 * capArrays for one page of results: `obj[pageField]` is the page that starts at `obj.offset`.
 * Sets `has_more` and `next_offset` from the records actually kept, so following `next_offset`
 * neither skips nor repeats a record. When not even one record fits, the first is kept with its
 * long strings shortened, so paging always advances.
 */
export function capPage(obj, pageField, otherFields, budget) {
  const page = obj[pageField];
  // Reserve next_offset's bytes while measuring; its final value is never longer.
  const out = capArrays({ ...obj, next_offset: obj.offset + page.length }, [pageField, ...otherFields], budget);
  if (!out[pageField].length && page.length) out[pageField] = [shrinkToFit(out, pageField, page[0], budget)];
  const kept = out[pageField].length;
  out.has_more = obj.has_more || kept < page.length;
  if (out.has_more) out.next_offset = obj.offset + kept;
  else delete out.next_offset;
  return out;
}

// Ids and URLs are shorter than this floor, so shortening never breaks a reference.
const MIN_SHORTENED_LENGTH = 200;

const shortenStrings = (x, max) => {
  if (typeof x === 'string') return truncateText(x, max);
  if (Array.isArray(x)) return x.map((y) => shortenStrings(y, max));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, shortenStrings(y, max)]));
  return x;
};

const longestString = (x) => {
  if (typeof x === 'string') return x.length;
  if (x && typeof x === 'object') return Math.max(0, ...Object.values(x).map(longestString));
  return 0;
};

function shrinkToFit(out, field, record, budget) {
  let lo = MIN_SHORTENED_LENGTH;
  let hi = Math.max(lo, longestString(record));
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (jsonLen({ ...out, [field]: [shortenStrings(record, mid)] }) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return shortenStrings(record, lo);
}

export const continueHint = (noun) => `To continue, pass the previous page's next_offset: a page cut to fit the output budget holds fewer than limit ${noun}.`;

export const nextPageLine = (s) => (s.next_offset === undefined ? undefined : `More results: call again with offset ${s.next_offset}.`);
