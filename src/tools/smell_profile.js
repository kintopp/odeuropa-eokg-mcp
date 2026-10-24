// eokg_smell_profile — concept-anchored aggregates (timeline, languages, qualities, ...) under one wall-clock budget.

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import { ToolError } from '../lib/errors.js';
import { parseId, vocabOf, KG_BASE } from '../lib/ids.js';
import { pickLabel, labelFromUri } from '../lib/rdf.js';
import { withWarnings } from '../lib/warnings.js';
import { progressReporter } from '../lib/progress.js';
import { mapPool } from '../lib/async.js';
import { sparqlSelect, v, num } from '../sparql/client.js';
import {
  anchorPattern, profileTotalQuery, profileFacetQuery, conceptLabelQuery,
} from '../sparql/queries/profile.js';
import {
  READ_ONLY_ANNOTATIONS, REQUEST_TIMEOUT_MS, SPARQL_MAX_CONCURRENCY, TEXT_LANGUAGES, DATASET_GRAPH_BASE,
  FRAGRANT_SPACES_BASE, PROFILE_FACETS, PROFILE_DEFAULT_FACETS, PROFILE_NARROWER_DEFAULT_FACETS,
  PROFILE_GESTURE_DEFAULT_FACETS, PROFILE_GESTURE_NARROWER_DEFAULT_FACETS,
  PROFILE_MAX_NARROWER_FACETS, PROFILE_CALL_DEADLINE_MS, PROFILE_MIN_FACET_BUDGET_MS, PROFILE_DEFAULT_TOP,
  PROFILE_MAX_TOP, TIMELINE_MIN_YEAR, TIMELINE_MAX_YEAR, LANGUAGE_NAMES,
} from '../config.js';

export const SMELL_PROFILE_TOOL_NAME = 'eokg_smell_profile';

const VOCAB_PREFIX = `${KG_BASE}vocabulary/`;

const inputSchema = z.object({
  concept: z.string().min(1).max(300).describe(
    'An olfactory-objects, fragrant-spaces or olfactory-gestures concept id as eokg_find_concepts returns it (e.g. olfactory-objects/138 for Rose, olfactory-gestures/2 for holding one\'s nose).',
  ),
  facets: z.array(z.enum([...PROFILE_FACETS])).min(1).max(PROFILE_FACETS.length).optional().describe(
    `Which aggregates to compute. Default: ${PROFILE_DEFAULT_FACETS.join(', ')} (with include_narrower: ${PROFILE_NARROWER_DEFAULT_FACETS.join(', ')}). Opt-in: emission_timeline, places, carriers.`,
  ),
  include_narrower: z.boolean().default(false).describe(
    `Also count smells of narrower concepts (e.g. Flower for every flower). Slow: allows at most ${PROFILE_MAX_NARROWER_FACETS} facets.`,
  ),
  bucket_years: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(20).describe('Timeline bucket width: 10, 20 or 50 years.'),
  top: z.number().int().min(1).max(PROFILE_MAX_TOP).default(PROFILE_DEFAULT_TOP).describe('Values per ranked facet.'),
  language: z.enum([...TEXT_LANGUAGES]).optional().describe('Only count smells from sources in this language. Not combinable with include_narrower.'),
}).strict();

// A factory, so no zod instance is shared between fields (a shared instance can serialise to $ref).
const timelineSchema = (basis) => z.object({
  basis: z.literal(basis),
  bucket_years: z.number().int(),
  buckets: z.array(z.object({ start: z.number().int(), count: z.number().int() })),
  out_of_range: z.number().int(),
  dated: z.number().int(),
});
const topList = () => z.array(z.object({ label: z.string(), count: z.number().int() }));
const idTopList = () => z.array(z.object({
  id: z.string().optional(), label: z.string(), lang: z.string().optional(), count: z.number().int(),
}));

export const outputSchema = z.object({
  concept: z.object({ id: z.string(), label: z.string().optional(), vocab: z.string() }),
  include_narrower: z.boolean(),
  language: z.string().optional(),
  total_smells: z.number().int(),
  timeline: timelineSchema('document_date').optional(),
  emission_timeline: timelineSchema('emission_date').optional(),
  languages: topList().optional(),
  datasets: topList().optional(),
  qualities: idTopList().optional(),
  emotions: topList().optional(),
  fragrant_spaces: idTopList().optional(),
  places: topList().optional(),
  carriers: topList().optional(),
  failed_facets: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});

const description =
  'Profile a smell source, fragrant space or gesture across the whole graph. ' +
  'Counts smells linked to an olfactory-objects, fragrant-spaces or olfactory-gestures concept (from eokg_find_concepts) by 20-year period of document date (bucket_years changes it), language, dataset, qualities, emotions and fragrant spaces; emission dates, raw place labels and carriers on request. ' +
  'The languages facet counts text smells only; image smells are in the total and the timeline but have no language. ' +
  'The emission date is extracted from the text but in almost every record equals the document date, so emission_timeline rarely differs from timeline. ' +
  'All values are machine-extracted: dates include OCR noise (reported as out_of_range), and emotions are inferred by a classifier. ' +
  'Gesture smells come almost entirely from images, so a gesture profile leaves out languages by default. ' +
  'include_narrower adds sub-concepts (e.g. all flowers) but takes 15–30 s per facet; facets that do not fit the time budget are listed in failed_facets.';

const fmt = (n) => n.toLocaleString('en-US');
const shortId = (uri) => uri.slice(VOCAB_PREFIX.length);
const count = (r) => Math.round(num(r, 'n') ?? 0);

const skipWarning = (f) => `The ${f} facet was skipped (time budget); request it on its own.`;
const timeoutWarning = (f) => `The ${f} facet timed out; try without include_narrower or with a narrower concept.`;

function shapeTimeline(rows, basis, bucketYears) {
  const buckets = [];
  let outOfRange = 0;
  for (const r of rows) {
    const start = num(r, 'start');
    const n = count(r);
    if (start === undefined) continue;
    if (start >= TIMELINE_MIN_YEAR && start < TIMELINE_MAX_YEAR) buckets.push({ start: Math.round(start), count: n });
    else outOfRange += n;
  }
  buckets.sort((a, b) => a.start - b.start);
  const dated = buckets.reduce((s, b) => s + b.count, outOfRange);
  return { basis, bucket_years: bucketYears, buckets, out_of_range: outOfRange, dated };
}

const tidy = (s) => s.replace(/\s+/g, ' ').trim();
const plain = (key) => (rows) => rows.filter((r) => v(r, key)).map((r) => ({ label: tidy(v(r, key)), count: count(r) }));

function localEntry(r, key, base) {
  const uri = v(r, key);
  if (!uri) return null;
  const local = uri.startsWith(base);
  const term = r.label ?? r.rlabel;
  const label = tidy(pickLabel(term ? [term] : []) ?? labelFromUri(uri));
  return {
    ...(local && { id: shortId(uri) }), label, ...(term?.['xml:lang'] && { lang: term['xml:lang'] }), count: count(r), local,
  };
}

const SHAPERS = {
  languages: plain('lang'),
  emotions: plain('word'),
  places: plain('pl'),
  carriers: plain('cl'),
  datasets: (rows) => rows.filter((r) => v(r, 'g')?.startsWith(DATASET_GRAPH_BASE))
    .map((r) => ({ label: tidy(v(r, 'g').slice(DATASET_GRAPH_BASE.length)), count: count(r) })),
  qualities: (rows) => rows.map((r) => localEntry(r, 'q', VOCAB_PREFIX)).filter(Boolean)
    .map(({ local: _local, ...e }) => e),
  fragrant_spaces: (rows) => rows.map((r) => localEntry(r, 'space', FRAGRANT_SPACES_BASE))
    .filter((e) => e?.local).map(({ local: _local, ...e }) => e),
};

function shapeFacet(facet, rows, bucketYears) {
  if (facet === 'timeline') return shapeTimeline(rows, 'document_date', bucketYears);
  if (facet === 'emission_timeline') return shapeTimeline(rows, 'emission_date', bucketYears);
  return SHAPERS[facet](rows);
}

const LIST_LABELS = {
  languages: 'Languages', datasets: 'Datasets', qualities: 'Qualities', emotions: 'Emotions (machine-inferred)',
  fragrant_spaces: 'Fragrant spaces', places: 'Place words (raw text)', carriers: 'Carrier words (raw text)',
};

function renderTimeline(t, title) {
  const cells = t.buckets.map((b) => `${b.start}–${b.start + t.bucket_years - 1} ${fmt(b.count)}`);
  const noise = t.out_of_range ? ` (${fmt(t.out_of_range)} outside ${TIMELINE_MIN_YEAR}–${TIMELINE_MAX_YEAR - 1}, probably extraction noise)` : '';
  return `${title}: ${cells.join(' · ') || '(none)'}${noise}`;
}

function renderText(s) {
  const head = `${s.concept.label ?? s.concept.id} [${shortId(s.concept.id)}]: ${fmt(s.total_smells)} smells` +
    (s.include_narrower ? ', including narrower concepts' : '') + (s.language ? `, in ${s.language}` : '');
  const lines = [head];
  if (s.timeline) lines.push(renderTimeline(s.timeline, 'By document date'));
  if (s.emission_timeline) lines.push(renderTimeline(s.emission_timeline, 'By emission date'));
  for (const [key, label] of Object.entries(LIST_LABELS)) {
    if (!s[key]) continue;
    lines.push(`${label}: ${s[key].map((x) => `${x.label} ${fmt(x.count)}`).join(' · ') || '(none)'}`);
  }
  return lines.join('\n');
}

export function registerSmellProfileTool(server) {
  server.registerTool(
    SMELL_PROFILE_TOOL_NAME,
    { title: SMELL_PROFILE_TOOL_NAME, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS },
    withTool(SMELL_PROFILE_TOOL_NAME, 'Profiling failed', async (args, ctx) => {
      const signal = ctx?.mcpReq?.signal;
      const concept = parseId('concept', args.concept);
      const vocab = vocabOf(concept);
      if (!vocab?.linked) {
        throw new ToolError(
          'This vocabulary is not linked to smells.',
          'Use eokg_find_concepts with the default vocabularies to find a linked concept.',
        );
      }
      const { include_narrower: narrower, language, bucket_years: bucketYears, top } = args;
      if (narrower && language) {
        throw new ToolError(
          '`language` cannot be combined with include_narrower.',
          'Drop one of them: the combination is too slow for the endpoint.',
        );
      }
      const gesture = vocab.name === 'olfactory-gestures';
      const defaults = gesture
        ? (narrower ? PROFILE_GESTURE_NARROWER_DEFAULT_FACETS : PROFILE_GESTURE_DEFAULT_FACETS)
        : (narrower ? PROFILE_NARROWER_DEFAULT_FACETS : PROFILE_DEFAULT_FACETS);
      let facets = [...new Set(args.facets ?? defaults)];
      if (narrower && facets.length > PROFILE_MAX_NARROWER_FACETS) {
        throw new ToolError(
          `include_narrower allows at most ${PROFILE_MAX_NARROWER_FACETS} facets per call.`,
          'Split the facets over several calls.',
        );
      }

      const warnings = [];
      if (gesture && !args.facets) {
        warnings.push('Gesture smells come almost entirely from images, which have no language, so the languages facet is not computed by default.');
      }
      if (vocab.name === 'fragrant-spaces' && facets.includes('fragrant_spaces')) {
        facets = facets.filter((f) => f !== 'fragrant_spaces');
        warnings.push('The fragrant_spaces facet was dropped: it would only repeat the concept itself.');
      }

      const deadline = Date.now() + PROFILE_CALL_DEADLINE_MS;
      const timeoutLeft = () => Math.floor(Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
      const anchor = anchorPattern(concept, vocab.name, { narrower, language });

      const [totalRows, labelRows] = await Promise.all([
        sparqlSelect('profile_total', profileTotalQuery(anchor), { signal, timeoutMs: timeoutLeft() }),
        sparqlSelect('concept_label', conceptLabelQuery(concept, vocab.name), { signal, timeoutMs: timeoutLeft() }),
      ]);
      const totalSmells = totalRows.length ? count(totalRows[0]) : 0;
      const label = pickLabel(labelRows.map((r) => r.l));

      const out = {
        concept: { id: concept, ...(label && { label }), vocab: vocab.name },
        include_narrower: narrower,
        ...(language && { language }),
        total_smells: totalSmells,
      };

      const failed = new Set();
      if (totalSmells === 0) {
        for (const f of facets) out[f] = shapeFacet(f, [], bucketYears);
        warnings.push(language
          ? `No ${LANGUAGE_NAMES[language]} smells are linked to this concept.`
          : 'No smells are linked to this concept.');
      } else {
        const report = progressReporter(ctx);
        let done = 0;
        await mapPool(facets, narrower ? 1 : SPARQL_MAX_CONCURRENCY, async (facet) => {
          const left = timeoutLeft();
          if (left < PROFILE_MIN_FACET_BUDGET_MS) {
            failed.add(facet);
            warnings.push(skipWarning(facet));
          } else {
            try {
              const rows = await sparqlSelect(`profile_${facet}`, profileFacetQuery(facet, anchor, { bucketYears, top }), {
                signal, timeoutMs: left,
              });
              out[facet] = shapeFacet(facet, rows, bucketYears);
            } catch (err) {
              if (err?.timeout !== true) throw err;
              failed.add(facet);
              warnings.push(timeoutWarning(facet));
            }
          }
          done++;
          report(done, facets.length, `Facet ${done}/${facets.length}: ${facet}`);
        });
      }
      const failedFacets = facets.filter((f) => failed.has(f));
      const structured = { ...out, ...(failedFacets.length && { failed_facets: failedFacets }) };
      const res = withWarnings({ structured, text: renderText(structured) }, warnings);
      return { content: [{ type: 'text', text: res.text }], structuredContent: res.structured };
    }),
  );
}
