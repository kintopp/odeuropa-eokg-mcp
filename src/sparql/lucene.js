// Lucene query text: SPARQL literal escaping, validation and field scoping.

import { ToolError } from '../lib/errors.js';

const ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/** Escape a JS string for a SPARQL "…" literal: \ → \\, " → \", newline → \n, CR → \r, tab → \t. */
export function sparqlString(s) {
  return String(s).replace(/[\\"\n\r\t]/g, (c) => ESCAPES[c]);
}

const MAX_TEXT = 500;
const QUOTED = /"(?:[^"\\]|\\.)*"/g;
const FIELD_PREFIX = /(^|[\s(+\-!])[A-Za-z_][A-Za-z0-9_]*:(?!\/\/)/;
const WILDCARD_ONLY = /^[\s*?]+$/;

/**
 * Validate the user's Lucene text and scope it to fields. Throws ToolError for empty, over-long,
 * field-prefixed or wildcard-only text. Returns the full luc:query string, e.g. 'source_value:(rose AND garden)'.
 */
export function scopedLuceneQuery(text, scope = 'excerpt') {
  const t = String(text ?? '').trim();
  if (!t) throw new ToolError('`text` is empty.', 'Pass words, a "quoted phrase" or a Lucene expression.');
  if (t.length > MAX_TEXT) {
    throw new ToolError(`\`text\` is longer than ${MAX_TEXT} characters.`, 'Shorten the query to its key terms.');
  }
  if (FIELD_PREFIX.test(t.replace(QUOTED, ' '))) {
    throw new ToolError(
      'Field prefixes like "title:" are not supported in `text`.',
      'Remove the prefix and use the `in` argument ("excerpt", "title" or "both").',
    );
  }
  if (WILDCARD_ONLY.test(t)) {
    throw new ToolError('`text` is only a wildcard.', 'Add at least one real search term.');
  }
  const excerpt = `source_value:(${t})`;
  const title = `source_label:(${t})`;
  if (scope === 'title') return title;
  if (scope === 'both') return `${excerpt} || ${title}`;
  return excerpt;
}
