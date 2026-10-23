// Pure helpers over SPARQL JSON bindings (no I/O).

import { isLocal } from './ids.js';

/** Best display label from literal terms {value, 'xml:lang'?}: en, then untagged, then first seen. Trimmed. */
export function pickLabel(terms) {
  const list = (terms ?? []).filter((t) => t && typeof t.value === 'string' && t.value.trim());
  const best = list.find((t) => t['xml:lang'] === 'en') ?? list.find((t) => !t['xml:lang']) ?? list[0];
  return best?.value.trim();
}

/** Fallback label from a URI: decoded last path segment, '_' → ' '. */
export function labelFromUri(uri) {
  const last = String(uri).split('/').pop() ?? '';
  let seg = last;
  try { seg = decodeURIComponent(last); } catch { /* keep raw */ }
  return seg.replaceAll('_', ' ');
}

/** Group rows by `keyVar` (URI), collecting `labelVar` terms; drops non-local keys; first-seen order. */
export function collectByUri(rows, keyVar, labelVar) {
  const groups = new Map();
  for (const row of rows) {
    const id = row[keyVar]?.value;
    if (!id || !isLocal(id)) continue;
    if (!groups.has(id)) groups.set(id, []);
    if (row[labelVar]) groups.get(id).push(row[labelVar]);
  }
  return [...groups].map(([id, terms]) => ({ id, label: pickLabel(terms) ?? labelFromUri(id) }));
}

/** Unique, trimmed, non-empty strings in first-seen order (case-sensitive). */
export function uniqueStrings(values) {
  const seen = new Set();
  for (const s of values) {
    const t = typeof s === 'string' ? s.trim() : '';
    if (t) seen.add(t);
  }
  return [...seen];
}
