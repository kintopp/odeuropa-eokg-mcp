// Code-side snippets for filtered searches, where Lucene snippets would cost the whole window.

import { SNIPPET_CHARS } from '../config.js';

const OPERATORS = new Set(['AND', 'OR', 'NOT']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termPatterns(luceneText) {
  const words = luceneText.replace(/["()]/g, ' ').split(/\s+/);
  const patterns = [];
  for (const w of words) {
    if (!w || OPERATORS.has(w) || w === '&&' || w === '||') continue;
    const bare = w.replace(/^[+\-!]+/, '').replace(/[~^][\d.]*$/, '');
    const wild = /[*?]/.test(bare);
    const core = bare.replace(/[*?]+$/, '');
    if (!core || /[*?]/.test(core)) continue;
    patterns.push(escapeRe(core) + (wild ? '[\\p{L}\\p{N}]*' : ''));
  }
  return patterns.sort((a, b) => b.length - a.length);
}

/**
 * A window of at most SNIPPET_CHARS of `text` around the first match of any plain term of `luceneText`,
 * with matches wrapped in <em>…</em> as Lucene does. No match: the leading SNIPPET_CHARS. '…' marks cuts.
 */
export function makeSnippet(text, luceneText) {
  const patterns = termPatterns(luceneText ?? '');
  const re = patterns.length ? new RegExp(patterns.join('|'), 'giu') : null;
  const first = re ? re.exec(text) : null;
  let start = 0;
  if (first) start = Math.max(0, first.index - Math.floor((SNIPPET_CHARS - first[0].length) / 2));
  const end = Math.min(text.length, start + SNIPPET_CHARS);
  start = Math.max(0, end - SNIPPET_CHARS);
  let body = text.slice(start, end);
  if (re) body = body.replace(new RegExp(patterns.join('|'), 'giu'), (m) => `<em>${m}</em>`);
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}
