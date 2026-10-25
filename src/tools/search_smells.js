// eokg_search_smells — Lucene full-text search; language/year/dataset filters run after ranking over an adaptive window.

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import { ToolError, assertYearRange } from '../lib/errors.js';
import { explorerUrl, uuidOf } from '../lib/ids.js';
import { pickLabel, uniqueStrings } from '../lib/rdf.js';
import { capPage, nextPageLine } from '../lib/budget.js';
import { withWarnings } from '../lib/warnings.js';
import { progressReporter } from '../lib/progress.js';
import { makeSnippet } from '../lib/snippet.js';
import { sparqlSelect, v, num } from '../sparql/client.js';
import { scopedLuceneQuery, luceneHints } from '../sparql/lucene.js';
import {
  searchCountQuery, searchPageQuery, searchWindowQuery, searchEnrichQuery,
} from '../sparql/queries/search.js';
import {
  READ_ONLY_ANNOTATIONS, DATASET_GRAPH_BASE, DATASET_NAMES, TEXT_LANGUAGES, EXCERPT_INJECTION_BOUNDARY,
  PER_CHANNEL_RESULT_BUDGET, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, SEARCH_MAX_OFFSET, SEARCH_WINDOWS,
  SEARCH_MAX_FILTERED_DEPTH,
} from '../config.js';

export const SEARCH_SMELLS_TOOL_NAME = 'eokg_search_smells';

const inputSchema = z.object({
  text: z.string().min(1).max(500).describe(
    'Lucene query text without field prefixes. Words without an operator are OR-ed: write AND/OR/NOT in capitals, and quote phrases and hyphenated words ("eau de cologne"). Trailing * and ? wildcards and ~ fuzzy matching work. Accents and umlauts must match exactly (égouts ≠ egouts); search both forms when unsure. Search in the language of the texts you want.',
  ),
  in: z.enum(['excerpt', 'title', 'both']).default('excerpt').describe('Search the smell excerpts (default), the source titles, or both.'),
  language: z.enum([...TEXT_LANGUAGES]).optional().describe('Only smells from sources in this language.'),
  year_from: z.number().int().min(1000).max(2100).optional().describe('Earliest document date, inclusive. A date range such as 1616/1678 counts by its first year. Undated sources are kept.'),
  year_to: z.number().int().min(1000).max(2100).optional().describe('Latest document date, inclusive. A date range such as 1616/1678 counts by its first year. Undated sources are kept.'),
  dataset: z.enum([...DATASET_NAMES]).optional().describe('Only smells from this source corpus (see eokg_list_datasets).'),
  limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).default(SEARCH_DEFAULT_LIMIT).describe('Results per page.'),
  offset: z.number().int().min(0).max(SEARCH_MAX_OFFSET).default(0).describe('Results to skip. To continue, pass the previous page\'s next_offset: a page cut to fit the output budget holds fewer than limit results.'),
}).strict();

export const outputSchema = z.object({
  query: z.string(),
  total_hits: z.number().int(),
  filtered: z.boolean(),
  scanned: z.number().int().optional(),
  exhaustive: z.boolean().optional(),
  offset: z.number().int(),
  limit: z.number().int(),
  has_more: z.boolean(),
  next_offset: z.number().int().optional(),
  results: z.array(z.object({
    id: z.string(), explorer_url: z.string(), score: z.number(), dataset: z.string(),
    source_id: z.string(), source_type: z.enum(['text', 'image']), title: z.string().optional(),
    language: z.string().optional(), date: z.string().optional(),
    concepts: z.array(z.string()), snippets: z.array(z.string()),
  })),
  truncated: z.record(z.string(), z.number().int()).optional(),
  warnings: z.array(z.string()).optional(),
});

const description =
  'Full-text search of smell excerpts and source titles, ranked by relevance. ' +
  'Matching is on the extracted excerpt text (OCR, unnormalised spelling). Language, year and dataset filters are applied after ranking, to a window of the most relevant hits, so a filtered search reports how many hits it scanned and may miss rarer matches; the result says when. ' +
  'Year filters use the document date; undated sources are kept. ' +
  'One passage can contain several smells; each is its own result with its own id and concept, so the same excerpt can appear more than once. ' +
  'Follow up with eokg_get_smell for a full record.';

const MAX_LUCENE_SNIPPETS = 3;
const fmt = (n) => n.toLocaleString('en-US');
const NO_HITS = 'No hits. Excerpts keep historical spelling and OCR errors; try variants or a trailing * wildcard.';
const partialWarning = (scanned, total) =>
  `Filters were applied to the ${fmt(scanned)} most relevant of ${fmt(total)} full-text hits; matches beyond that window were not examined. To reach them, narrow the text (add terms, use a phrase) or search in the filter's language (e.g. "rosa" for Italian).`;

const dropUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));
const totalOf = (rows) => (rows.length ? num(rows[0], 'total') ?? 0 : undefined);

async function unfilteredPage(lq, limit, offset, signal) {
  const rows = await sparqlSelect('search_page', searchPageQuery(lq, limit, offset), { signal });
  const order = [];
  const snippets = new Map();
  const scores = new Map();
  for (const r of rows) {
    const id = v(r, 'id');
    if (!snippets.has(id)) { order.push(id); snippets.set(id, []); scores.set(id, num(r, 'score') ?? 0); }
    const sn = v(r, 'snip');
    const list = snippets.get(id);
    if (sn && list.length < MAX_LUCENE_SNIPPETS && !list.includes(sn)) list.push(sn);
  }
  let total = totalOf(rows);
  if (total === undefined) {
    total = 0;
    if (offset > 0) total = totalOf(await sparqlSelect('search_count', searchCountQuery(lq), { signal })) ?? 0;
  }
  return {
    total, ids: order.slice(0, limit), hasMore: order.length > limit, scores, snippets,
  };
}

async function filteredWindows(lq, filters, limit, offset, ctx, signal) {
  const report = progressReporter(ctx);
  let total;
  let scanned = 0;
  let rows = [];
  for (let i = 0; i < SEARCH_WINDOWS.length; i++) {
    const W = SEARCH_WINDOWS[i];
    report(i + 1, SEARCH_WINDOWS.length, `Scanning ${W} hits`);
    const win = sparqlSelect('search_window', searchWindowQuery(lq, W, filters, limit, offset), { signal });
    if (total === undefined) {
      const [countRows, winRows] = await Promise.all([
        sparqlSelect('search_count', searchCountQuery(lq), { signal }), win,
      ]);
      total = totalOf(countRows) ?? 0;
      rows = winRows;
    } else {
      rows = await win;
    }
    scanned = Math.min(W, total);
    if (rows.length > limit || W >= total) break;
  }
  return {
    total, scanned, exhaustive: scanned >= total, ids: rows.slice(0, limit).map((r) => v(r, 'id')),
    hasMore: rows.length > limit, scores: new Map(rows.map((r) => [v(r, 'id'), num(r, 'score') ?? 0])),
  };
}

function shapeEnriched(rows, ids, page, filtered, text) {
  const byId = new Map(ids.map((id) => [id, []]));
  for (const r of rows) byId.get(v(r, 'id'))?.push(r);
  return ids.map((id) => {
    const rs = byId.get(id);
    const first = rs[0];
    const excerpt = rs.map((r) => v(r, 'text')).find(Boolean);
    let snippets = filtered ? [] : page.snippets.get(id) ?? [];
    if (!snippets.length && excerpt) snippets = [makeSnippet(excerpt, text)];
    return dropUndefined({
      id,
      explorer_url: explorerUrl('smell', id),
      score: page.scores.get(id) ?? 0,
      dataset: first ? v(first, 'graph').slice(DATASET_GRAPH_BASE.length) : '',
      source_id: first ? v(first, 'source') : '',
      source_type: first && v(first, 'type').endsWith('E36_Visual_Item') ? 'image' : 'text',
      title: pickLabel(rs.map((r) => r.title).filter(Boolean)),
      language: first && v(first, 'lang'),
      date: first && v(first, 'date'),
      concepts: uniqueStrings(rs.map((r) => v(r, 'cl'))),
      snippets,
    });
  });
}

const isUndated = (r) => !r.date || !/^\d/.test(r.date);

function renderText(s) {
  const head = `${fmt(s.total_hits)} full-text hits for ${s.query}` +
    (s.filtered ? `; ${s.results.length} on this page after filters (scanned ${fmt(s.scanned)})` : '');
  const blocks = s.results.map((r, i) => {
    const meta = [isUndated(r) ? 'undated' : r.date, r.language, r.dataset].filter(Boolean).join(', ');
    const concepts = r.concepts.length ? ` — concepts: ${r.concepts.join(', ')}` : '';
    const lines = [`${s.offset + i + 1}. ${r.title ?? '(untitled)'} (${meta})${concepts}`];
    for (const sn of r.snippets) lines.push(`   «${sn.replace(/\s+/g, ' ')}»`);
    const src = uuidOf(r.source_id) ?? r.source_id;
    lines.push(
      r.source_type === 'image'
        ? `   id: ${uuidOf(r.id) ?? r.id} · image source: ${src} (for eokg_view_image / eokg_inspect_image)`
        : `   id: ${uuidOf(r.id) ?? r.id} · source: ${src}`,
    );
    return lines.join('\n');
  });
  const hasSnippets = s.results.some((r) => r.snippets.length);
  return [head, hasSnippets && EXCERPT_INJECTION_BOUNDARY, ...blocks, nextPageLine(s)].filter(Boolean).join('\n\n');
}

export function registerSearchSmellsTool(server) {
  server.registerTool(
    SEARCH_SMELLS_TOOL_NAME,
    { title: SEARCH_SMELLS_TOOL_NAME, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS },
    withTool(SEARCH_SMELLS_TOOL_NAME, 'Search failed', async (args, ctx) => {
      const signal = ctx?.mcpReq?.signal;
      const { limit, offset, language, dataset } = args;
      const yearFrom = args.year_from;
      const yearTo = args.year_to;
      assertYearRange(yearFrom, yearTo);
      const lq = scopedLuceneQuery(args.text, args.in);
      const filtered = Boolean(language || dataset || yearFrom != null || yearTo != null);
      if (filtered && offset + limit > SEARCH_MAX_FILTERED_DEPTH) {
        throw new ToolError(
          `Filtered searches reach at most ${SEARCH_MAX_FILTERED_DEPTH} results deep (offset + limit).`,
          'Add narrower filters or search terms instead of paging deeper.',
        );
      }
      const page = filtered
        ? await filteredWindows(lq, { language, yearFrom, yearTo, dataset }, limit, offset, ctx, signal)
        : await unfilteredPage(lq, limit, offset, signal);

      const enrichRows = page.ids.length
        ? await sparqlSelect('search_enrich', searchEnrichQuery(page.ids), { signal })
        : [];
      const results = shapeEnriched(enrichRows, page.ids, page, filtered, args.text);

      const warnings = [];
      if (filtered && !page.exhaustive) warnings.push(partialWarning(page.scanned, page.total));
      if (page.total === 0) warnings.push(NO_HITS);
      const undated = results.filter(isUndated).length;
      if ((yearFrom != null || yearTo != null) && undated > 0) {
        warnings.push(
          `${undated} of the ${results.length} results on this page are undated; year filters keep undated sources. Check each date before using it in a period claim.`,
        );
      }
      warnings.push(...luceneHints(args.text));

      const full = {
        query: lq, total_hits: page.total, filtered,
        ...(filtered && { scanned: page.scanned, exhaustive: page.exhaustive }),
        offset, limit, has_more: page.hasMore, results,
      };
      const structured = capPage(full, 'results', [], PER_CHANNEL_RESULT_BUDGET);
      const res = withWarnings({ structured, text: renderText(structured) }, warnings);
      return { content: [{ type: 'text', text: res.text }], structuredContent: res.structured };
    }),
  );
}
