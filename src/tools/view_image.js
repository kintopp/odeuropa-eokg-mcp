// eokg_view_image — opens the MCP App image viewer for an image source; no image bytes pass through the server.

import { z } from 'zod';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { withTool } from '../lib/tool.js';
import { parseId } from '../lib/ids.js';
import { mirrorWarnings } from '../lib/warnings.js';
import { sparqlSelect } from '../sparql/client.js';
import { imageFragmentsQuery } from '../sparql/queries/source.js';
import { shapeFragments, lookupHostedImage } from './get_source.js';
import { READ_ONLY_ANNOTATIONS, FRAGMENT_MIN_SCORE_DEFAULT } from '../config.js';

export const VIEW_IMAGE_TOOL_NAME = 'eokg_view_image';
export const VIEWER_RESOURCE_URI = 'ui://odeuropa/image-viewer.html';

const inputSchema = z.object({
  id: z.string().min(1).max(300).describe('Image source id: a http://data.odeuropa.eu/source/<uuid> URI or bare uuid.'),
  min_score: z.number().min(0).max(1).default(FRAGMENT_MIN_SCORE_DEFAULT)
    .describe(`Hide detector boxes scoring below this (0-1, default ${FRAGMENT_MIN_SCORE_DEFAULT}). Hand-drawn boxes score 1 but are not verified and can carry the wrong label.`),
  show_boxes: z.boolean().default(false)
    .describe('Draw the object boxes on the image. Leave false unless the user asks to see the boxes; many carry the wrong label.'),
}).strict();

const box = () => z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const outputSchema = z.object({
  id: z.string(), title: z.string().optional(), artist: z.string().optional(), date: z.string().optional(),
  image_url: z.string(), url: z.string().optional(), original_image_url: z.string().optional(),
  min_score: z.number(), show_boxes: z.boolean(),
  objects: z.array(z.object({
    concept_id: z.string(), label: z.string(), score: z.number(), origin: z.enum(['detector', 'manual', 'unknown']),
    box_px: box(),
  })),
  hidden_below_min_score: z.number().int(),
  warnings: z.array(z.string()).optional(),
});

const description =
  'Show an artwork image to the user in an interactive viewer they can zoom. ' +
  'The viewer appears beside this result in clients that support MCP Apps (Claude, ChatGPT and others). ' +
  'Object boxes start hidden, and the user can turn them on and off with the viewer\'s Boxes button. Set show_boxes true only when the user asks to see them, since many boxes carry the wrong label. When boxes are on, the user can select one, and the selection is shared with you. ' +
  'Nothing is returned for you to look at; use eokg_inspect_image to see the picture yourself. ' +
  'If the user says no viewer appeared, give them the Record and Image links from the result as plain links. ' +
  'Takes a source id from eokg_search_smells (source_id), eokg_get_source or eokg_find_visual_smells.';

// "Pipe ×2, Glass, Lemon (manual)": counts per label, manual-only labels marked.
function labelSummary(objects) {
  const groups = new Map();
  for (const o of objects) {
    const g = groups.get(o.label) ?? { label: o.label, count: 0, manual: true };
    g.count++;
    if (o.origin !== 'manual') g.manual = false;
    groups.set(o.label, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((g) => `${g.label}${g.count > 1 ? ` ×${g.count}` : ''}${g.manual ? ' (manual)' : ''}`)
    .join(', ');
}

function renderText(s) {
  const who = s.artist ? ` by ${s.artist}` : '';
  const when = s.date ? ` (${s.date})` : '';
  const lines = [`"${s.title ?? '(untitled)'}"${who}${when} — opened in the image viewer, boxes ${s.show_boxes ? 'shown' : 'hidden'}.`];
  if (s.url) lines.push(`Record: ${s.url}`);
  lines.push(`Image: ${s.image_url}`);
  if (s.original_image_url) lines.push(`Original: ${s.original_image_url}`);
  const shown = s.show_boxes ? '' : ', not shown to the user';
  let objects = s.objects.length
    ? `Objects boxed in the graph (score ≥ ${s.min_score}${shown}): ${labelSummary(s.objects)}.`
    : `No objects boxed in the graph at score ≥ ${s.min_score}.`;
  if (s.hidden_below_min_score > 0) objects += ` ${s.hidden_below_min_score} lower-scoring detections hidden.`;
  lines.push(objects);
  lines.push(s.show_boxes
    ? 'The user can hide them with the viewer\'s Boxes button.'
    : 'The user can turn boxes on with the viewer\'s Boxes button. Show them only if the user asks (show_boxes: true); many carry the wrong label.');
  lines.push('If the user sees no viewer, give them these links as plain links; never embed the image as a Markdown image.');
  return lines.join('\n');
}

export function registerViewImageTool(server) {
  registerAppTool(
    server,
    VIEW_IMAGE_TOOL_NAME,
    {
      title: VIEW_IMAGE_TOOL_NAME, description, inputSchema, outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: { resourceUri: VIEWER_RESOURCE_URI } },
    },
    withTool(VIEW_IMAGE_TOOL_NAME, 'Opening the image viewer failed', async (args, ctx) => {
      const signal = ctx?.mcpReq?.signal;
      const { id, imageUrl, originalImageUrl, meta, warnings } = await lookupHostedImage(parseId('source', args.id), signal);
      const fragRows = await sparqlSelect('image_fragments', imageFragmentsQuery(id), { signal });
      const all = shapeFragments(fragRows);
      const objects = all.filter((o) => o.score >= args.min_score);

      const structured = {
        id,
        ...(meta.title && { title: meta.title }),
        ...(meta.artist && { artist: meta.artist }),
        ...(meta.date && { date: meta.date }),
        image_url: imageUrl,
        ...(meta.url && { url: meta.url }),
        ...(originalImageUrl && { original_image_url: originalImageUrl }),
        min_score: args.min_score, show_boxes: args.show_boxes,
        objects,
        hidden_below_min_score: all.length - objects.length,
        ...(warnings.length && { warnings }),
      };
      const content = [{ type: 'text', text: mirrorWarnings(renderText(structured), warnings) }];
      // Claude Desktop's stdio bridge strips structuredContent before it reaches the iframe; the page falls back to this block.
      if (process.env.EOKG_ENTRY_POINT !== 'http') content.push({ type: 'text', text: JSON.stringify(structured) });
      return { content, structuredContent: structured };
    }),
  );
}
