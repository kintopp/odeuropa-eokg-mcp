// Lucene query text: SPARQL literal escaping, validation and field scoping.

import { ToolError } from '../lib/errors.js';

const ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/** Escape a JS string for a SPARQL "…" literal: \ → \\, " → \", newline → \n, CR → \r, tab → \t. */
export function sparqlString(s) {
  return String(s).replace(/[\\"\n\r\t]/g, (c) => ESCAPES[c]);
}

const MAX_TEXT = 500;
const QUOTED = /"(?:[^"\\]|\\.)*"/g;
const PREFIX_AT = /(?<=^|[\s(+\-!])([A-Za-z_][A-Za-z0-9_]*):(?!\/\/)/g;
const RESERVED_FIELDS = new Set([
  'source_value', 'source_label', 'title', 'excerpt', 'text', 'label', 'lang', 'language',
  'date', 'year', 'dataset', 'author', 'artist', 'source',
]);
const WILDCARD_ONLY = /^[\s*?]+$/;

/** Escape ':' after a non-reserved name and '/' (except '://') outside quoted phrases, so neither reaches Lucene as syntax. */
function escapeUnquoted(t) {
  const esc = (seg) =>
    seg
      .replace(PREFIX_AT, '$1\\:')
      .replace(/\\.|:\/\/|\//g, (m) => (m === '/' ? '\\/' : m));
  let out = '';
  let last = 0;
  for (const m of t.matchAll(QUOTED)) {
    out += esc(t.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + esc(t.slice(last));
}

/** A query whose every term is negated matches nothing in Lucene. */
function assertPositiveTerm(t) {
  const tokens = t.replace(QUOTED, ' Q ').replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  let negateNext = false;
  let negated = 0;
  let positive = 0;
  for (const tok of tokens) {
    if (['AND', 'OR', '&&', '||'].includes(tok)) continue;
    if (tok === 'NOT' || tok === '-' || tok === '!') {
      negateNext = true;
      continue;
    }
    if (negateNext || /^[-!]./.test(tok)) negated++;
    else positive++;
    negateNext = false;
  }
  if (negated > 0 && positive === 0) {
    throw new ToolError(
      'The query has no positive term: `NOT` and `-` only exclude matches.',
      'Add a term to search for, e.g. "smell NOT tobacco".',
    );
  }
}

/** Warnings for query shapes that run but rarely mean what the writer intended. */
export function luceneHints(text) {
  const masked = String(text ?? '').replace(QUOTED, ' ');
  const hints = [];
  if (/\S\s+(?:and|or)\s+\S/.test(masked)) {
    hints.push(
      'Lower-case "and"/"or" are searched as words, and words without an operator are OR-ed. Write AND/OR in capitals.',
    );
  }
  const hyphenated = masked
    .split(/\s+/)
    .map((w) => w.replace(/^[()+]+|[()]+$/g, ''))
    .find((w) => /[\p{L}\p{N}]-[\p{L}\p{N}]/u.test(w));
  if (hyphenated) {
    hints.push(
      `Hyphenated words are split into separate words that are OR-ed (${hyphenated} matches ${hyphenated.split('-').join(' OR ')}). Quote them: "${hyphenated.split('-').join(' ')}".`,
    );
  }
  return hints;
}

/**
 * Validate the user's Lucene text and scope it to fields. Throws ToolError for empty, over-long,
 * field-prefixed, wildcard-only or purely negated text. Returns the full luc:query string, e.g.
 * 'source_value:(rose AND garden)'.
 */
export function scopedLuceneQuery(text, scope = 'excerpt') {
  const t = String(text ?? '').trim();
  if (!t) throw new ToolError('`text` is empty.', 'Pass words, a "quoted phrase" or a Lucene expression.');
  if (t.length > MAX_TEXT) {
    throw new ToolError(`\`text\` is longer than ${MAX_TEXT} characters.`, 'Shorten the query to its key terms.');
  }
  const masked = t.replace(QUOTED, ' ');
  if ([...masked.matchAll(PREFIX_AT)].some((m) => RESERVED_FIELDS.has(m[1].toLowerCase()))) {
    throw new ToolError(
      'Field prefixes like "title:" are not supported in `text`.',
      'Remove the prefix and use the `in` argument ("excerpt", "title" or "both").',
    );
  }
  if (WILDCARD_ONLY.test(t)) {
    throw new ToolError('`text` is only a wildcard.', 'Add at least one real search term.');
  }
  assertPositiveTerm(t);
  const safe = escapeUnquoted(t);
  const excerpt = `source_value:(${safe})`;
  const title = `source_label:(${safe})`;
  if (scope === 'title') return title;
  if (scope === 'both') return `${excerpt} || ${title}`;
  return excerpt;
}
