// Id allowlist for every tool input. Ids are interpolated into SPARQL as `<…>`,
// so parseId is the injection guard: nothing that fails it may reach a query.

import { EXPLORER_BASE_URL, VOCABS } from '../config.js';
import { ToolError } from './errors.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const KG_BASE = 'http://data.odeuropa.eu/';
// kind → { group, explorer, match? }. `explorer` is the Explorer path segment or null;
// `match(input) → canonicalUri | null` replaces the uuid matching for non-uuid kinds.
const VOCAB_PREFIX = `${KG_BASE}vocabulary/`;
const CONCEPT_RE = /^https?:\/\/data\.odeuropa\.eu\/vocabulary\/([a-z0-9][a-z0-9_-]*)((?:\/[A-Za-z0-9_.-]+)+)\/?$/;
const SHORT_CONCEPT_RE = /^([a-z0-9][a-z0-9_-]*)((?:\/[A-Za-z0-9_.-]+)+)\/?$/;

const EXPLORER_CONCEPT_RE = /^https?:\/\/explorer\.odeuropa\.eu\/(smell-sources|fragrant-spaces)\/(\d+)\/?$/i;
const EXPLORER_VOCAB = { 'smell-sources': 'olfactory-objects', 'fragrant-spaces': 'fragrant-spaces' };

function matchConcept(raw) {
  const ex = EXPLORER_CONCEPT_RE.exec(raw);
  if (ex) return `${VOCAB_PREFIX}${EXPLORER_VOCAB[ex[1].toLowerCase()]}/${ex[2]}`;
  const m = CONCEPT_RE.exec(raw) ?? SHORT_CONCEPT_RE.exec(raw);
  if (!m || m[2].split('/').some((seg) => seg === '.' || seg === '..')) return null;
  return `${VOCAB_PREFIX}${m[1]}${m[2]}`;
}

const KINDS = {
  smell: { group: 'smell', explorer: 'smells' },
  source: { group: 'source', explorer: null },
  concept: { group: 'vocabulary', explorer: null, match: matchConcept },
};

const EXPLORER_RE = new RegExp(`^https?://explorer\\.odeuropa\\.eu/smells/(${UUID})/?$`, 'i');

/**
 * Normalise a user-supplied id of `kind` to its canonical KG URI, or throw ToolError.
 * Accepts: the canonical URI; the same with https://; a bare uuid; and for smells
 * the Explorer permalink. Trims whitespace, lower-cases the uuid.
 */
export function parseId(kind, input) {
  const spec = KINDS[kind];
  const raw = typeof input === 'string' ? input.trim() : '';
  let canonical = null;
  if (spec) {
    if (spec.match) {
      canonical = spec.match(raw);
    } else {
      const { group, explorer } = spec;
      const uri = new RegExp(`^https?://data\\.odeuropa\\.eu/${group}/(${UUID})$`, 'i').exec(raw);
      const bare = new RegExp(`^(${UUID})$`, 'i').exec(raw);
      const link = explorer ? EXPLORER_RE.exec(raw) : null;
      const uuid = (uri || bare || link)?.[1];
      if (uuid) canonical = `${KG_BASE}${group}/${uuid.toLowerCase()}`;
    }
  }
  if (!canonical) {
    const group = spec?.group ?? kind;
    throw new ToolError(
      `Not a valid ${kind} id: "${String(input ?? '').slice(0, 120)}"`,
      kind === 'concept'
        ? 'Pass the id as eokg_find_concepts returns it: olfactory-objects/138, the http://data.odeuropa.eu/vocabulary/… URI, or an Explorer smell-sources/… or fragrant-spaces/… link.'
        : `Pass the id exactly as another eokg tool returned it (a http://data.odeuropa.eu/${group}/<uuid> URI or the bare uuid).`,
    );
  }
  return canonical;
}

/** Last path segment if it is a uuid, else null. */
export function uuidOf(uri) {
  const last = String(uri).split('/').pop();
  return new RegExp(`^${UUID}$`, 'i').test(last) ? last.toLowerCase() : null;
}

/** First path segment after vocabulary/ of a concept URI, as is. */
export function schemeOf(conceptUri) {
  return String(conceptUri).slice(VOCAB_PREFIX.length).split('/')[0];
}

/** The VOCABS row for a concept URI's scheme, or null. */
export function vocabOf(conceptUri) {
  const scheme = schemeOf(conceptUri);
  return VOCABS.find((vo) => vo.name === scheme) ?? null;
}

/** Explorer permalink for smells and linked-vocabulary concepts; null otherwise. */
export function explorerUrl(kind, uri) {
  if (kind === 'concept') {
    const seg = { 'olfactory-objects': 'smell-sources', 'fragrant-spaces': 'fragrant-spaces' }[schemeOf(uri)];
    const local = String(uri).slice(VOCAB_PREFIX.length).split('/').slice(1);
    return seg && local.length === 1 ? `${EXPLORER_BASE_URL}/${seg}/${local[0]}` : null;
  }
  const seg = KINDS[kind]?.explorer;
  const uuid = uuidOf(uri);
  return seg && uuid ? `${EXPLORER_BASE_URL}/${seg}/${uuid}` : null;
}

/** False for sameAs twins (wikidata etc.). */
export function isLocal(uri) {
  return typeof uri === 'string' && uri.startsWith(KG_BASE);
}
