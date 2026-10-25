// eokg_find_visual_smells — image sources (paintings, prints) linked to one olfactory-objects concept, best detection first.

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import { ToolError, assertYearRange } from '../lib/errors.js';
import { parseId, vocabOf, uuidOf, KG_BASE } from '../lib/ids.js';
import { pickLabel } from '../lib/rdf.js';
import { capPage, continueHint, nextPageLine, truncateText } from '../lib/budget.js';
import { withWarnings } from '../lib/warnings.js';
import { sparqlSelect, v, num } from '../sparql/client.js';
import { conceptLabelQuery } from '../sparql/queries/profile.js';
import { visualCountQuery, visualPageQuery } from '../sparql/queries/visual.js';
import {
  READ_ONLY_ANNOTATIONS, PER_CHANNEL_RESULT_BUDGET, VISUAL_DEFAULT_LIMIT, VISUAL_MAX_LIMIT, FRAGMENT_MIN_SCORE_DEFAULT,
} from '../config.js';

export const FIND_VISUAL_SMELLS_TOOL_NAME = 'eokg_find_visual_smells';

const ARTIST_MAX_CHARS = 120;
const VOCAB_PREFIX = `${KG_BASE}vocabulary/`;

const inputSchema = z.object({
  concept: z.string().min(1).max(300).describe(
    'An olfactory-objects or olfactory-gestures concept id as eokg_find_concepts returns it (e.g. olfactory-objects/138 for Rose, olfactory-gestures/2 for holding one\'s nose). Exact concept only, no narrower concepts.',
  ),
  year_from: z.number().int().min(1000).max(2100).optional().describe('Earliest artwork date (inclusive). Undated works are excluded.'),
  year_to: z.number().int().min(1000).max(2100).optional().describe('Latest artwork date (inclusive). Undated works are excluded.'),
  limit: z.number().int().min(1).max(VISUAL_MAX_LIMIT).default(VISUAL_DEFAULT_LIMIT).describe('Results per page.'),
  offset: z.number().int().min(0).max(5000).default(0).describe(`Results to skip. ${continueHint('results')}`),
  min_score: z.number().min(0).max(1).default(FRAGMENT_MIN_SCORE_DEFAULT).describe(
    `Hide images whose boxes for this concept all score below this (0-1, default ${FRAGMENT_MIN_SCORE_DEFAULT}); boxes and best_score count only boxes at or above it. Hand-drawn boxes score 1. Pass 0 for every image.`,
  ),
}).strict();

export const outputSchema = z.object({
  concept: z.object({ id: z.string(), label: z.string().optional() }),
  total: z.number().int(),
  hidden_below_min_score: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
  min_score: z.number(),
  has_more: z.boolean(),
  next_offset: z.number().int().optional(),
  results: z.array(z.object({
    id: z.string(),
    title: z.string().optional(),
    artist: z.string().optional(),
    date: z.string().optional(),
    image_url: z.string(),
    best_score: z.number().nullable(),
    boxes: z.number().int(),
  })),
  truncated: z.record(z.string(), z.number().int()).optional(),
  warnings: z.array(z.string()).optional(),
});

const description =
  'Find paintings and prints in which a smell source or gesture appears. ' +
  'Lists image sources linked to an olfactory-objects or olfactory-gestures concept, best box score first: images with hand-drawn boxes (score 1) come first, then images ranked by the object detector\'s confidence, then catalogue-only links with no box. ' +
  `Images whose boxes all score below min_score (default ${FRAGMENT_MIN_SCORE_DEFAULT}) are hidden and counted; boxes and best_score count only the boxes shown. ` +
  'Images are linked to the objects they show, so substances often have none; try a related object concept. ' +
  'Year filters use the artwork date and exclude undated works. Pass a result id to eokg_inspect_image to look at it.';

const fmt = (n) => n.toLocaleString('en-US');

function shapeRow(r) {
  const boxes = num(r, 'boxes') ?? 0;
  const best = num(r, 'best');
  const artist = v(r, 'artist')?.trim();
  const title = pickLabel(r.title ? [r.title] : []);
  return {
    id: v(r, 'source'),
    ...(title && { title }),
    ...(artist && { artist: truncateText(artist, ARTIST_MAX_CHARS) }),
    ...(v(r, 'date') && { date: v(r, 'date') }),
    image_url: v(r, 'image'),
    best_score: boxes === 0 || best === undefined ? null : best,
    boxes,
  };
}

function renderText(s) {
  const name = s.concept.label ?? s.concept.id.slice(VOCAB_PREFIX.length);
  const hiddenLine = s.hidden_below_min_score > 0 &&
    `${fmt(s.hidden_below_min_score)} more images have only boxes scoring below ${s.min_score}; pass min_score 0 to include them.`;
  if (!s.results.length) return [`${fmt(s.total)} image sources represent ${name}; none on this page.`, hiddenLine].filter(Boolean).join('\n');
  const head = `${fmt(s.total)} image sources represent ${name}; showing ${s.offset + 1}–${s.offset + s.results.length} (best detection first):`;
  const lines = s.results.map((r, i) => {
    const who = [r.artist, r.date && `(${r.date})`].filter(Boolean).join(' ');
    const det = r.best_score === null ? 'catalogued only' : `best ${r.best_score.toFixed(2)}, ${r.boxes} boxes`;
    return `${s.offset + i + 1}. "${r.title ?? '(untitled)'}"${who ? `, ${who}` : ''} — ${det} — id ${uuidOf(r.id) ?? r.id}`;
  });
  return [head, ...lines, nextPageLine(s), hiddenLine].filter(Boolean).join('\n');
}

export function registerFindVisualSmellsTool(server) {
  server.registerTool(
    FIND_VISUAL_SMELLS_TOOL_NAME,
    { title: FIND_VISUAL_SMELLS_TOOL_NAME, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS },
    withTool(FIND_VISUAL_SMELLS_TOOL_NAME, 'Finding images failed', async (args, ctx) => {
      const signal = ctx?.mcpReq?.signal;
      const concept = parseId('concept', args.concept);
      const vocab = vocabOf(concept);
      if (!vocab?.images) {
        throw new ToolError('Only olfactory-objects and olfactory-gestures concepts have images.', 'Find one with eokg_find_concepts.');
      }
      const { limit, offset } = args;
      const years = { yearFrom: args.year_from, yearTo: args.year_to };
      assertYearRange(years.yearFrom, years.yearTo);
      const q = (name, text) => sparqlSelect(name, text, { signal });
      const [countRows, pageRows, labelRows] = await Promise.all([
        q('visual_count', visualCountQuery(concept, years, args.min_score)),
        q('visual_page', visualPageQuery(concept, years, args.min_score, limit, offset)),
        q('concept_label', conceptLabelQuery(concept, vocab.name)),
      ]);
      const int = (key) => Math.round(num(countRows[0] ?? {}, key) ?? 0);
      const hidden = int('hidden');
      const total = int('n') - hidden;
      const label = pickLabel(labelRows.map((r) => r.l));
      const results = pageRows.slice(0, limit).map(shapeRow);

      const full = {
        concept: { id: concept, ...(label && { label }) },
        total, hidden_below_min_score: hidden, offset, limit, min_score: args.min_score, has_more: pageRows.length > limit, results,
      };
      const structured = capPage(full, 'results', [], PER_CHANNEL_RESULT_BUDGET);
      const warnings = [];
      if (total === 0 && hidden > 0) {
        warnings.push(`All ${fmt(hidden)} linked images have only boxes scoring below ${args.min_score}; lower min_score to see them.`);
      } else if (total === 0 && (years.yearFrom != null || years.yearTo != null)) {
        warnings.push('No image sources are linked to this concept in this date range.');
      } else if (total === 0) {
        warnings.push('No image sources are linked to this concept. Images are linked to depicted objects, so a substance (Coffee, Incense, Sulphur) often has none; eokg_get_concept lists related objects (Coffee → Coffeepot) to try instead.');
      }
      const res = withWarnings({ structured, text: renderText(structured) }, warnings);
      return { content: [{ type: 'text', text: res.text }], structuredContent: res.structured };
    }),
  );
}
