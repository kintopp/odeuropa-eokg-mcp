// eokg_find_concepts — vocabulary concepts by label (Skosmos) or by Iconclass notation (sidecar).

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import { ToolError } from '../lib/errors.js';
import { parseId, explorerUrl, KG_BASE } from '../lib/ids.js';
import { pickLabel, labelFromUri } from '../lib/rdf.js';
import { withWarnings } from '../lib/warnings.js';
import { sparqlSelect, v, lang as langOf } from '../sparql/client.js';
import { conceptLabelsQuery } from '../sparql/queries/concept.js';
import { skosmosSearch } from '../skosmos/client.js';
import iconclassData from '../data/iconclass.json' with { type: 'json' };
import {
  READ_ONLY_ANNOTATIONS, VOCABS, VOCAB_NAMES, DEFAULT_CONCEPT_VOCABS, FIND_CONCEPTS_MAX_LIMIT,
  TEXT_LANGUAGES,
} from '../config.js';

export const FIND_CONCEPTS_TOOL_NAME = 'eokg_find_concepts';

const VOCAB_PREFIX = `${KG_BASE}vocabulary/`;
const ICONCLASS_SCHEMES = ['olfactory-objects', 'fragrant-spaces'];

const inputSchema = z.object({
  query: z.string().min(1).max(100).optional().describe(
    'Label to search for, in any of de, en, fr, it, nl, sl (e.g. "rose", "jardin"). A trailing * is added unless present.',
  ),
  iconclass: z.string().min(1).max(100).regex(/^[0-9][0-9A-Za-z()+.,' -]*$/).optional().describe(
    'Iconclass notation (e.g. 25G41(ROSE)) instead of query: finds concepts mapped to it or to broader or narrower notations.',
  ),
  vocab: z.union([
    z.enum([...VOCAB_NAMES]),
    z.array(z.enum([...VOCAB_NAMES])).min(1).max(5),
    z.literal('all'),
  ]).optional().describe(
    'Vocabulary or vocabularies to search. Default: olfactory-objects and fragrant-spaces, the two linked to smells. "all" searches every vocabulary.',
  ),
  lang: z.enum([...TEXT_LANGUAGES]).optional().describe('Prefer labels in this language.'),
  limit: z.number().int().min(1).max(FIND_CONCEPTS_MAX_LIMIT).default(10).describe('Maximum results (default 10).'),
}).strict();

export const outputSchema = z.object({
  query: z.string().optional(),
  iconclass: z.string().optional(),
  results: z.array(z.object({
    id: z.string(), label: z.string(), lang: z.string().optional(), vocab: z.string(),
    linked_to: z.enum(['smells', 'places']).nullable(),
    alt_label: z.string().optional(),
    explorer_url: z.string().nullable(),
    notation: z.string().optional(),
    iconclass_match: z.enum(['exact', 'broader', 'narrower']).optional(),
  })),
  has_more: z.boolean(),
  warnings: z.array(z.string()).optional(),
});

const description =
  'Find smell-source and fragrant-space concepts by label, in any language. ' +
  'Matches labels in de, en, fr, it, nl or sl; a trailing * is added unless the query already has one. By default searches the two vocabularies linked to smells: olfactory-objects (what smells) and fragrant-spaces (where). ' +
  'Pass a concept id to eokg_get_concept or eokg_smell_profile; vocab "all" also searches the descriptive vocabularies, which are not linked to smells. ' +
  'Alternatively pass iconclass (a notation such as 25G41(ROSE), e.g. from an Iconclass or Rijksmuseum server) instead of query, to find the concepts Odeuropa mapped to that notation or to broader or narrower ones.';

const shortId = (uri) => uri.slice(VOCAB_PREFIX.length);

function resolveVocabs(vocab) {
  if (vocab === undefined) return VOCABS.filter((x) => DEFAULT_CONCEPT_VOCABS.includes(x.name));
  if (vocab === 'all') return [...VOCABS];
  const names = Array.isArray(vocab) ? vocab : [vocab];
  return VOCABS.filter((x) => names.includes(x.name));
}

const stem = (n) => n.replace(/\(\.\.\.\)$/, '');

// First rule that holds wins. A placeholder S(...) against a named query S(NAME) is 'named':
// provisional until the concept's labels show it is NAME (other siblings are neither broader nor narrower).
function classify(n, q) {
  const s = stem(n);
  if (n === q) return 'exact';
  if (n.endsWith('(...)') && q.startsWith(`${s}(`) && q.endsWith(')') && q.length > s.length + 2) return 'named';
  if (n.startsWith(q)) return 'narrower';
  // A placeholder means "S with some name", never an ancestor of a different notation.
  if (!n.endsWith('(...)') && q.startsWith(s)) return 'broader';
  return null;
}

const RANK = { exact: 0, broader: 1, narrower: 2 };

// Every candidate (concept, notation, match) before 'named' is resolved.
function iconclassCandidates(q, vocabRows) {
  const allowed = new Set(vocabRows.map((x) => x.name));
  const out = [];
  for (const scheme of ICONCLASS_SCHEMES) {
    if (!allowed.has(scheme)) continue;
    for (const [local, notations] of Object.entries(iconclassData[scheme])) {
      for (const notation of notations) {
        const match = classify(notation, q);
        if (match) out.push({ uri: `${VOCAB_PREFIX}${scheme}/${local}`, scheme, local, notation, match });
      }
    }
  }
  return out;
}

// Keep each concept's best match, then order: exact, broader (longest stem first), narrower (by notation).
function rankMatches(cands) {
  const best = new Map();
  for (const c of cands) {
    const prev = best.get(c.uri);
    if (!prev || RANK[c.match] < RANK[prev.match]) best.set(c.uri, c);
  }
  const order = (a, b) => RANK[a.match] - RANK[b.match]
    || (a.match === 'broader' ? stem(b.notation).length - stem(a.notation).length : 0)
    || (a.match === 'narrower' ? a.notation.localeCompare(b.notation) : 0)
    || a.scheme.localeCompare(b.scheme) || Number(a.local) - Number(b.local);
  return [...best.values()].sort(order);
}

function shapeResult({ uri, label, lang, vocabName, alt, extra }) {
  const row = VOCABS.find((x) => x.name === vocabName);
  const out = { id: uri, label, vocab: vocabName, linked_to: row?.linked ?? null, explorer_url: explorerUrl('concept', uri) };
  if (lang) out.lang = lang;
  if (alt) out.alt_label = alt;
  return { ...out, ...extra };
}

function renderText(heading, results) {
  const lines = results.map((r) => {
    const parts = [`- ${r.label} [${shortId(r.id)}]`];
    if (r.iconclass_match) parts.push(`${r.notation} (${r.iconclass_match})`);
    if (r.linked_to) parts.push(`linked to ${r.linked_to}`);
    return parts.join(' — ');
  });
  return [heading, ...lines].join('\n');
}

async function findByIconclass(args, signal) {
  const q = args.iconclass.trim();
  const cands = iconclassCandidates(q, resolveVocabs(args.vocab));
  const warnings = [];
  const labels = new Map();
  let found = [];
  if (cands.length) {
    const uris = [...new Set(cands.map((c) => c.uri))];
    const rows = await sparqlSelect('concept_labels', conceptLabelsQuery(uris), { signal });
    const terms = new Map();
    for (const r of rows) {
      const uri = v(r, 'c');
      if (!terms.has(uri)) terms.set(uri, []);
      terms.get(uri).push({ value: v(r, 'l'), 'xml:lang': langOf(r, 'l') });
    }
    for (const [uri, list] of terms) {
      const wanted = args.lang && list.find((t) => t['xml:lang'] === args.lang);
      labels.set(uri, wanted?.value ?? pickLabel(list));
    }
    const resolved = [];
    for (const c of cands) {
      if (c.match !== 'named') { resolved.push(c); continue; }
      const name = q.slice(stem(c.notation).length + 1, -1).trim().toLowerCase();
      if ((terms.get(c.uri) ?? []).some((t) => t.value.trim().toLowerCase() === name)) {
        resolved.push({ ...c, match: 'exact' });
      }
    }
    found = rankMatches(resolved);
  }
  if (!found.length) {
    warnings.push(
      `No Odeuropa concept is mapped to ${q} or to a broader or narrower notation. Only ${countNotated()} concepts carry Iconclass notations; try query with a label instead.`,
    );
  }
  const kept = found.slice(0, args.limit);
  const results = kept.map((k) => shapeResult({
    uri: k.uri, label: labels.get(k.uri) ?? labelFromUri(k.uri), vocabName: k.scheme,
    extra: { notation: k.notation, iconclass_match: k.match },
  }));
  const structured = { iconclass: q, results, has_more: found.length > args.limit };
  const text = renderText(`${results.length} concepts for Iconclass ${q}:`, results);
  return withWarnings({ structured, text }, warnings);
}

const countNotated = () => ICONCLASS_SCHEMES.reduce((n, s) => n + Object.keys(iconclassData[s]).length, 0);

async function findByLabel(args, signal) {
  const vocabRows = resolveVocabs(args.vocab);
  const query = args.query.includes('*') ? args.query : `${args.query}*`;
  const hits = await skosmosSearch({
    query, vocabs: vocabRows.map((x) => x.skosmos), lang: args.lang,
    maxhits: Math.min(args.limit * 6, 300),
  }, { signal });

  const byUri = new Map();
  for (const h of hits) {
    if (!h?.uri) continue;
    const list = byUri.get(h.uri) ?? [];
    list.push(h);
    byUri.set(h.uri, list);
  }
  const bySkosmos = new Map(VOCABS.map((x) => [x.skosmos, x]));
  const shaped = [];
  let dropped = 0;
  for (const [rawUri, list] of byUri) {
    let uri;
    try { uri = parseId('concept', rawUri); } catch { dropped++; continue; }
    const pick = (args.lang && list.find((h) => h.lang === args.lang)) || list.find((h) => h.lang === 'en') || list[0];
    const vocabName = bySkosmos.get(pick.vocab)?.name ?? pick.vocab ?? uri.slice(VOCAB_PREFIX.length).split('/')[0];
    shaped.push(shapeResult({
      uri, label: pick.prefLabel ?? labelFromUri(uri), lang: pick.lang, vocabName,
      alt: Array.isArray(pick.altLabel) ? pick.altLabel[0] : pick.altLabel,
    }));
  }
  const ordered = [...shaped.filter((r) => r.linked_to), ...shaped.filter((r) => !r.linked_to)];
  const results = ordered.slice(0, args.limit);
  const warnings = dropped ? [`${dropped} result${dropped > 1 ? 's' : ''} skipped: the id could not be read as a concept.`] : [];
  const structured = { query, results, has_more: ordered.length > args.limit };
  return withWarnings({ structured, text: renderText(`${results.length} concepts for "${query}":`, results) }, warnings);
}

export function registerFindConceptsTool(server) {
  server.registerTool(
    FIND_CONCEPTS_TOOL_NAME,
    { title: FIND_CONCEPTS_TOOL_NAME, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS },
    withTool(FIND_CONCEPTS_TOOL_NAME, 'Finding concepts failed', async (args, ctx) => {
      if ((args.query === undefined) === (args.iconclass === undefined)) {
        throw new ToolError(
          'Pass either query or iconclass, not both and not neither.',
          'Use query for a label such as "rose", or iconclass for a notation such as 25G41(ROSE).',
        );
      }
      const signal = ctx?.mcpReq?.signal;
      const limit = args.limit ?? 10;
      const res = args.iconclass !== undefined
        ? await findByIconclass({ ...args, limit }, signal)
        : await findByLabel({ ...args, limit }, signal);
      return { content: [{ type: 'text', text: res.text }], structuredContent: res.structured };
    }),
  );
}
