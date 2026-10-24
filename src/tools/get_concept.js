// eokg_get_concept — one vocabulary concept: labels, hierarchy, usage counts, curated Iconclass notation.

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import { ToolError } from '../lib/errors.js';
import { parseId, explorerUrl, schemeOf, vocabOf, KG_BASE } from '../lib/ids.js';
import { pickLabel, collectByUri, uniqueStrings } from '../lib/rdf.js';
import { withWarnings } from '../lib/warnings.js';
import { fetchConceptTerms } from '../lib/concept_labels.js';
import { sparqlSelect, v, num, lang as langOf } from '../sparql/client.js';
import {
  conceptDetailQuery, conceptNarrowerQuery, conceptSmellCountQuery, conceptImageCountQuery, spaceSmellCountQuery,
  gestureSmellCountQuery,
} from '../sparql/queries/concept.js';
import iconclassData from '../data/iconclass.json' with { type: 'json' };
import { READ_ONLY_ANNOTATIONS, CONCEPT_MAX_NARROWER } from '../config.js';

export const GET_CONCEPT_TOOL_NAME = 'eokg_get_concept';

const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const SCHEMA_IMAGE = 'https://schema.org/image';
const VOCAB_PREFIX = `${KG_BASE}vocabulary/`;

const inputSchema = z.object({
  id: z.string().min(1).max(300).describe(
    'Concept id as eokg_find_concepts returns it: the http://data.odeuropa.eu/vocabulary/<scheme>/<id> URI or <scheme>/<id> (e.g. olfactory-objects/138).',
  ),
}).strict();

const idLabel = () => z.object({ id: z.string(), label: z.string() });

export const outputSchema = z.object({
  id: z.string(),
  vocab: z.string(),
  linked_to: z.enum(['smells', 'places']).nullable(),
  label: z.string(),
  labels: z.record(z.string(), z.string()),
  alt_labels: z.array(z.string()),
  broader: z.array(idLabel()),
  related: z.array(idLabel()),
  narrower: z.array(idLabel()),
  narrower_count: z.number().int(),
  image: z.string().optional(),
  iconclass: z.array(z.object({
    notation: z.string(), placeholder: z.boolean(), candidate: z.string().optional(),
  })).optional(),
  smell_count: z.number().int().optional(),
  image_source_count: z.number().int().optional(),
  explorer_url: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

const description =
  'Get a vocabulary concept: labels in six languages, hierarchy, and usage counts. ' +
  'For olfactory-objects, fragrant-spaces and olfactory-gestures concepts, also returns how many smells (and, for objects and gestures, image sources) the knowledge graph links to it, ' +
  'and the curated Iconclass notation where Odeuropa assigned one. A notation ending in (...) is an Iconclass placeholder for a name; the candidate with the name filled in is unverified, so check it with an Iconclass server before using it.';

// Data error: 21 skos:related links in fragrant-spaces use this namespace (underscore, no vocabulary/) for
// olfactory-objects concepts. Do not remove the mapping as dead code.
const MALFORMED_OBJECT_URI = /^http:\/\/data\.odeuropa\.eu\/olfactory_objects\/(\d+)$/;

/** Rewrite malformed object URIs in `rows[key]`; the rewritten URIs are added to `remapped`. */
function remapMalformed(rows, key, remapped) {
  return rows.map((r) => {
    const m = MALFORMED_OBJECT_URI.exec(r[key]?.value ?? '');
    if (!m) return r;
    const fixed = `${VOCAB_PREFIX}olfactory-objects/${m[1]}`;
    remapped.add(fixed);
    return { ...r, [key]: { ...r[key], value: fixed } };
  });
}

const fmt = (n) => n.toLocaleString('en-US');

function iconclassFor(id, label) {
  const scheme = schemeOf(id);
  const local = id.slice(VOCAB_PREFIX.length).split('/').slice(1).join('/');
  const notations = iconclassData[scheme]?.[local];
  if (!notations) return undefined;
  return notations.map((notation) => {
    const placeholder = notation.endsWith('(...)');
    const out = { notation, placeholder };
    if (placeholder && label) out.candidate = notation.replace('(...)', `(${label.toUpperCase()})`);
    return out;
  });
}

function renderText(s) {
  const langs = Object.entries(s.labels).sort(([a], [b]) => a.localeCompare(b)).map(([l, t]) => `${l} ${t}`);
  const names = (xs) => (xs.length ? xs.map((x) => x.label).join(', ') : '(none)');
  const narrower = s.narrower_count > s.narrower.length
    ? `${names(s.narrower)} (+${s.narrower_count - s.narrower.length} more)` : names(s.narrower);
  const lines = [
    `${s.label} [${s.id.slice(VOCAB_PREFIX.length)}] — ${langs.join(' · ') || '(no labels)'}`,
    `Broader: ${names(s.broader)} · Narrower: ${narrower}`,
  ];
  if (s.related.length) lines.push(`Related: ${names(s.related)}`);
  const counts = [
    s.smell_count !== undefined && `${fmt(s.smell_count)} smells`,
    s.image_source_count !== undefined && `${fmt(s.image_source_count)} image sources`,
  ].filter(Boolean);
  if (counts.length) lines.push(`Linked: ${counts.join(', ')}`);
  if (s.iconclass) {
    const parts = s.iconclass.map((i) => (i.placeholder
      ? `${i.notation} — placeholder for a name${i.candidate ? `; candidate ${i.candidate} (unverified)` : ''}`
      : i.notation));
    lines.push(`Iconclass: ${parts.join(' | ')}`);
  }
  if (s.explorer_url) lines.push(`Explorer: ${s.explorer_url}`);
  return lines.join('\n');
}

export function registerGetConceptTool(server) {
  server.registerTool(
    GET_CONCEPT_TOOL_NAME,
    { title: GET_CONCEPT_TOOL_NAME, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS },
    withTool(GET_CONCEPT_TOOL_NAME, 'Getting the concept failed', async (args, ctx) => {
      const id = parseId('concept', args.id);
      const signal = ctx?.mcpReq?.signal;
      const row = vocabOf(id);
      const q = (name, text) => sparqlSelect(name, text, { signal });
      const [detail, narrowerRows, smellRows, imageRows] = await Promise.all([
        q('concept_detail', conceptDetailQuery(id)),
        q('concept_narrower', conceptNarrowerQuery(id, CONCEPT_MAX_NARROWER)),
        row?.name === 'olfactory-gestures' ? q('gesture_smell_count', gestureSmellCountQuery(id))
          : row?.linked === 'smells' ? q('concept_smell_count', conceptSmellCountQuery(id))
          : row?.linked === 'places' ? q('space_smell_count', spaceSmellCountQuery(id)) : [],
        row?.linked === 'smells' ? q('concept_image_count', conceptImageCountQuery(id)) : [],
      ]);
      if (!detail.length) {
        throw new ToolError(
          `No concept found with id ${id}.`,
          'Find the id with eokg_find_concepts and pass it as returned.',
        );
      }
      const remapped = new Set();
      const by = (p) => remapMalformed(detail.filter((r) => v(r, 'p') === `${SKOS}${p}`), 'o', remapped);
      const labels = {};
      for (const r of by('prefLabel')) {
        const l = langOf(r, 'o');
        if (l && !(l in labels)) labels[l] = v(r, 'o');
      }
      const prefTerms = by('prefLabel').map((r) => r.o);
      const label = labels.en ?? pickLabel(prefTerms) ?? id.split('/').pop();
      const altLabels = uniqueStrings(by('altLabel').map((r) => {
        const l = langOf(r, 'o');
        return l ? `${v(r, 'o')}@${l}` : v(r, 'o');
      }));
      const links = (rows, keyVar, labelVar) => collectByUri(rows, keyVar, labelVar).filter((x) => x.id !== id);
      const narrowerAll = links(remapMalformed(narrowerRows, 'n', remapped), 'n', 'l');
      const broader = links(by('broader'), 'o', 'olabel');
      const related = links(by('related'), 'o', 'olabel');
      if (remapped.size) {
        const terms = await fetchConceptTerms([...remapped], signal);
        for (const x of [...broader, ...related, ...narrowerAll]) {
          if (remapped.has(x.id) && terms.has(x.id)) x.label = pickLabel(terms.get(x.id));
        }
      }
      const warnings = [];
      if (narrowerAll.length > CONCEPT_MAX_NARROWER) {
        warnings.push(`This concept has ${narrowerAll.length} narrower concepts; only the first ${CONCEPT_MAX_NARROWER} are listed.`);
      }
      const firstImage = detail.find((r) => v(r, 'p') === SCHEMA_IMAGE);
      const full = {
        id,
        vocab: row?.name ?? schemeOf(id),
        linked_to: row?.linked ?? null,
        label,
        labels,
        alt_labels: altLabels,
        broader,
        related,
        narrower: narrowerAll.slice(0, CONCEPT_MAX_NARROWER),
        narrower_count: narrowerAll.length,
      };
      if (firstImage) full.image = v(firstImage, 'o');
      const iconclass = row?.linked ? iconclassFor(id, label) : undefined;
      if (iconclass) full.iconclass = iconclass;
      const smells = smellRows[0] && num(smellRows[0], 'smells');
      const images = imageRows[0] && num(imageRows[0], 'images');
      if (smells !== undefined) full.smell_count = smells;
      if (images !== undefined) full.image_source_count = images;
      const explorer = explorerUrl('concept', id);
      if (explorer) full.explorer_url = explorer;

      const res = withWarnings({ structured: full, text: renderText(full) }, warnings);
      return { content: [{ type: 'text', text: res.text }], structuredContent: res.structured };
    }),
  );
}
