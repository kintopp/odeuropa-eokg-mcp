// eokg_get_source — a source text or image: metadata, a page of its smells, and for images the detected objects.

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import { ToolError } from '../lib/errors.js';
import { parseId, uuidOf, isLocal } from '../lib/ids.js';
import { pickLabel, labelFromUri, uniqueStrings } from '../lib/rdf.js';
import { capArrays, truncateText } from '../lib/budget.js';
import { prune } from '../lib/prune.js';
import { sparqlSelect, v, num } from '../sparql/client.js';
import {
  sourceMetaQuery, sourceSmellCountQuery, sourceSmellPageQuery, imageFragmentsQuery,
} from '../sparql/queries/source.js';
import {
  READ_ONLY_ANNOTATIONS, EXCERPT_INJECTION_BOUNDARY, PER_CHANNEL_RESULT_BUDGET, IMAGE_URL_RE,
  SOURCE_DEFAULT_LIMIT, SOURCE_MAX_LIMIT, SOURCE_EXCERPT_CHARS, ANNOTATION_ORIGINS,
} from '../config.js';

export const GET_SOURCE_TOOL_NAME = 'eokg_get_source';

const inputSchema = z.object({
  id: z.string().min(1).max(300).describe(
    'Source id: the http://data.odeuropa.eu/source/<uuid> URI or the bare uuid, as returned by eokg_get_smell (source.id).',
  ),
  limit: z.number().int().min(1).max(SOURCE_MAX_LIMIT).default(SOURCE_DEFAULT_LIMIT)
    .describe(`Smells per page (1-${SOURCE_MAX_LIMIT}, default ${SOURCE_DEFAULT_LIMIT}).`),
  offset: z.number().int().min(0).max(100000).default(0).describe('Smells to skip, for paging.'),
}).strict();

const box = () => z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const outputSchema = z.object({
  id: z.string(), type: z.enum(['text', 'image']), title: z.string().optional(), url: z.string().optional(),
  language: z.string().optional(), date: z.string().optional(), year: z.number().int().optional(),
  author: z.string().optional(), artist: z.string().optional(), license: z.string().optional(), genre: z.string().optional(),
  place_created: z.string().optional(),
  image_url: z.string().optional(),
  original_image_url: z.string().optional(),
  smell_count: z.number().int(), offset: z.number().int(), limit: z.number().int(), has_more: z.boolean(),
  smells: z.array(z.object({ id: z.string(), concepts: z.array(z.string()), excerpt: z.string().optional() })),
  detected_objects: z.array(z.object({
    concept_id: z.string(), label: z.string(), score: z.number(), origin: z.enum(['detector', 'manual', 'unknown']),
    box_px: box(),
  })).optional(),
  truncated: z.record(z.string(), z.number().int()).optional(),
  warnings: z.array(z.string()).optional(),
});

const description =
  'Get a source text or image: its metadata and a page of the smells it contains. ' +
  'Smells are listed in no meaningful order (the graph keeps no position within the document), each with its vocabulary concepts and a short excerpt. ' +
  'For an image source, also lists the objects the detector found, with bounding boxes; call eokg_inspect_image to see the picture.';

const round1 = (n) => Math.round(n * 10) / 10;

/** Shape fragment rows to detected objects: local concepts only, px rounded, origin from the provenance activity. */
export function shapeFragments(rows) {
  return rows
    .filter((r) => isLocal(v(r, 'body')))
    .map((r) => ({
      concept_id: v(r, 'body'),
      label: v(r, 'label') ?? labelFromUri(v(r, 'body')),
      score: num(r, 'score'),
      origin: ANNOTATION_ORIGINS[v(r, 'prov')] ?? 'unknown',
      box_px: { x: round1(num(r, 'x')), y: round1(num(r, 'y')), w: round1(num(r, 'w')), h: round1(num(r, 'h')) },
    }));
}

/** Source-level metadata from the (cross-product) meta rows. */
export function shapeSourceMeta(id, rows) {
  const one = (key) => rows.map((r) => v(r, key)).find(Boolean);
  const images = uniqueStrings(rows.map((r) => v(r, 'image')));
  const begin = parseInt(one('begin'), 10);
  return {
    isImage: v(rows[0], 'type').endsWith('E36_Visual_Item'),
    imageUrl: images.find((u) => IMAGE_URL_RE.test(u)),
    originalImageUrl: images.find((u) => !IMAGE_URL_RE.test(u)),
    meta: prune({
      id,
      title: pickLabel(rows.map((r) => r.title)),
      url: one('url'), language: one('lang'), date: one('date'),
      year: Number.isFinite(begin) ? begin : undefined,
      author: one('author'), artist: one('artist'), license: one('license'), genre: one('genre'),
      place_created: one('place'),
    }),
  };
}

function renderText(s) {
  const who = s.author ?? s.artist;
  const meta = [s.date, s.language].filter(Boolean).join(', ');
  const first = s.offset + 1;
  const last = s.offset + s.smells.length;
  const lines = [
    `${s.title ?? '(untitled)'} — ${s.type} source${meta ? ` (${meta})` : ''}${who ? ` by ${who}` : ''}`,
    s.url,
    s.image_url && `Image: ${s.image_url}`,
    `${s.smell_count} smells${s.smells.length ? ` (showing ${first}–${last})` : ''}`,
  ];
  if (s.detected_objects?.length) {
    lines.push(`Detected objects: ${s.detected_objects.map((o) => `${o.label} ${+o.score.toFixed(3)}`).join(', ')}`);
  }
  if (s.smells.length) {
    lines.push('', EXCERPT_INJECTION_BOUNDARY, ...s.smells.map((m) => {
      const tag = m.concepts.length ? ` [${m.concepts.join(', ')}]` : '';
      return `${uuidOf(m.id) ?? m.id}${tag}${m.excerpt ? ` «${m.excerpt}»` : ''}`;
    }));
  }
  return lines.filter(Boolean).join('\n');
}

export function registerGetSourceTool(server) {
  server.registerTool(
    GET_SOURCE_TOOL_NAME,
    { title: GET_SOURCE_TOOL_NAME, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS },
    withTool(GET_SOURCE_TOOL_NAME, 'Getting the source failed', async (args, ctx) => {
      const id = parseId('source', args.id);
      const signal = ctx?.mcpReq?.signal;
      const { limit, offset } = args;
      const [metaRows, countRows, pageRows] = await Promise.all([
        sparqlSelect('source_meta', sourceMetaQuery(id), { signal }),
        sparqlSelect('source_smell_count', sourceSmellCountQuery(id), { signal }),
        sparqlSelect('source_smell_page', sourceSmellPageQuery(id, limit, offset), { signal }),
      ]);
      if (!metaRows.length) {
        throw new ToolError(
          `No source found with id ${id}.`,
          'Pass the id exactly as an eokg tool returned it (eokg_get_smell returns it as source.id).',
        );
      }
      const { isImage, imageUrl, originalImageUrl, meta } = shapeSourceMeta(id, metaRows);
      const smellCount = num(countRows[0] ?? {}, 'n') ?? 0;
      const smells = pageRows.map((r) => ({
        id: v(r, 'smell'),
        concepts: uniqueStrings((v(r, 'concepts') ?? '').split('|')),
        ...(v(r, 'excerpt') && { excerpt: truncateText(v(r, 'excerpt'), SOURCE_EXCERPT_CHARS) }),
      }));

      const full = {
        ...meta,
        type: isImage ? 'image' : 'text',
        image_url: imageUrl,
        original_image_url: originalImageUrl,
        smell_count: smellCount, offset, limit, has_more: offset + limit < smellCount,
        smells,
      };
      if (isImage) {
        const fragRows = await sparqlSelect('image_fragments', imageFragmentsQuery(id), { signal });
        full.detected_objects = shapeFragments(fragRows);
      }
      const structured = capArrays(dropUndefined(full), ['smells', 'detected_objects'], PER_CHANNEL_RESULT_BUDGET);
      return { content: [{ type: 'text', text: renderText(structured) }], structuredContent: structured };
    }),
  );
}

// Drop undefined optionals but keep the required (possibly empty) arrays and zeros.
function dropUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, val]) => val !== undefined));
}
