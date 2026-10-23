// Warning plumbing: warnings ride on structuredContent and are mirrored into the text channel.

const WARN_PREFIX = '⚠ ';

/**
 * The SINGLE place query warnings reach `content[].text`: append them under a
 * blank-line separator with a unified prefix. Callers MUST route warnings
 * through here (via withWarnings) rather than formatting their own `⚠ ` lines.
 * Returns `text` unchanged when there are no warnings.
 */
export function mirrorWarnings(text, warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return text;
  const block = warnings.map((w) => `${WARN_PREFIX}${w}`).join('\n');
  return text ? `${text}\n\n${block}` : block;
}

/**
 * Apply warnings to a `{ structured, text }` shaper result uniformly: non-empty
 * warnings ride on structuredContent (the schema-declared `warnings` field) and
 * are mirrored into the text channel. No-op (returns the same object) when
 * there are no warnings.
 */
export function withWarnings(response, warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return response;
  return {
    structured: { ...response.structured, warnings },
    text: mirrorWarnings(response.text, warnings),
  };
}
