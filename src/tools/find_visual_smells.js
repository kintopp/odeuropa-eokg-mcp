// eokg_find_visual_smells — image sources (paintings, prints) linked to one olfactory-objects concept, best detection first.

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import { ToolError } from '../lib/errors.js';
import { parseId, schemeOf, uuidOf, KG_BASE } from '../lib/ids.js';
import { pickLabel } from '../lib/rdf.js';
import { capArrays, truncateText } from '../lib/budget.js';
import { withWarnings } from '../lib/warnings.js';
import { sparqlSelect, v, num } from '../sparql/client.js';
import { conceptLabelQuery } from '../sparql/queries/profile.js';
import { visualCountQuery, visualPageQuery } from '../sparql/queries/visual.js';
import { READ_ONLY_ANNOTATIONS, PER_CHANNEL_RESULT_BUDGET, VISUAL_DEFAULT_LIMIT, VISUAL_MAX_LIMIT } from '../config.js';

export const FIND_VISUAL_SMELLS_TOOL_NAME = 'eokg_find_visual_smells';

const ARTIST_MAX_CHARS = 120;
const VOCAB_PREFIX = `${KG_BASE}vocabulary/`;

const inputSchema = z.object({
  concept: z.string().min(1).max(300).describe(
    'An olfactory-objects concept id as eokg_find_concepts returns it (e.g. olfactory-objects/138 for Rose). Exact concept only, no narrower concepts.',
  ),
  year_from: z.number().int().min(1000).max(2100).optional().describe('Earliest artwork date (inclusive). Undated works are excluded.'),
  year_to: z.number().int().min(1000).max(2100).optional().describe('Latest artwork date (inclusive). Undated works are excluded.'),
  limit: z.number().int().min(1).max(VISUAL_MAX_LIMIT).default(VISUAL_DEFAULT_LIMIT).describe('Results per page.'),
  offset: z.number().int().min(0).max(5000).default(0).describe('Results to skip.'),
}).strict();

export const outputSchema = z.object({
  concept: z.object({ id: z.string(), label: z.string().optional() }),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
  has_more: z.boolean(),
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
  'Find paintings and prints in which a smell source was detected or catalogued. ' +
  'Lists image sources linked to an olfactory-objects concept, best box score first: images with hand-drawn boxes (score 1) come first, then images ranked by the object detector\'s confidence, then catalogue-only links with no box. ' +
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
  if (!s.results.length) return `${fmt(s.total)} image sources represent ${name}; none on this page.`;
  const head = `${fmt(s.total)} image sources represent ${name}; showing ${s.offset + 1}–${s.offset + s.results.length} (best detection first):`;
  const lines = s.results.map((r, i) => {
    const who = [r.artist, r.date && `(${r.date})`].filter(Boolean).join(' ');
    const det = r.best_score === null ? 'catalogued only' : `best ${r.best_score.toFixed(2)}, ${r.boxes} boxes`;
    return `${s.offset + i + 1}. "${r.title ?? '(untitled)'}"${who ? `, ${who}` : ''} — ${det} — id ${uuidOf(r.id) ?? r.id}`;
  });
  return [head, ...lines].join('\n');
}

export function registerFindVisualSmellsTool(server) {
  server.registerTool(
    FIND_VISUAL_SMELLS_TOOL_NAME,
    { title: FIND_VISUAL_SMELLS_TOOL_NAME, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS },
    withTool(FIND_VISUAL_SMELLS_TOOL_NAME, 'Finding images failed', async (args, ctx) => {
      const signal = ctx?.mcpReq?.signal;
      const concept = parseId('concept', args.concept);
      if (schemeOf(concept) !== 'olfactory-objects') {
        throw new ToolError('Only olfactory-objects concepts have images.', 'Find one with eokg_find_concepts.');
      }
      const { limit, offset } = args;
      const years = { yearFrom: args.year_from, yearTo: args.year_to };
      if (years.yearFrom != null && years.yearTo != null && years.yearFrom > years.yearTo) {
        throw new ToolError('year_from is after year_to.', 'Swap them or widen the range.');
      }
      const q = (name, text) => sparqlSelect(name, text, { signal });
      const [countRows, pageRows, labelRows] = await Promise.all([
        q('visual_count', visualCountQuery(concept, years)),
        q('visual_page', visualPageQuery(concept, years, limit, offset)),
        q('concept_label', conceptLabelQuery(concept, 'olfactory-objects')),
      ]);
      const total = countRows.length ? Math.round(num(countRows[0], 'n') ?? 0) : 0;
      const label = pickLabel(labelRows.map((r) => r.l));
      const results = pageRows.slice(0, limit).map(shapeRow);

      const full = {
        concept: { id: concept, ...(label && { label }) },
        total, offset, limit, has_more: pageRows.length > limit, results,
      };
      const structured = capArrays(full, ['results'], PER_CHANNEL_RESULT_BUDGET);
      const warnings = total === 0 ? ['No image sources are linked to this concept in this date range.'] : [];
      const res = withWarnings({ structured, text: renderText(structured) }, warnings);
      return { content: [{ type: 'text', text: res.text }], structuredContent: res.structured };
    }),
  );
}
