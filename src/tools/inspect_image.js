// eokg_inspect_image — the picture of an image source plus its annotated objects, boxes as % of the frame.

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import { ToolError } from '../lib/errors.js';
import { parseId } from '../lib/ids.js';
import { jpegDimensions } from '../lib/jpeg.js';
import { mirrorWarnings } from '../lib/warnings.js';
import { sparqlSelect } from '../sparql/client.js';
import { sourceMetaQuery, imageFragmentsQuery } from '../sparql/queries/source.js';
import { fetchKgImage } from '../image/client.js';
import { shapeFragments, shapeSourceMeta } from './get_source.js';
import {
  READ_ONLY_ANNOTATIONS, IMAGE_URL_RE, VISION_MAX_EDGE, FRAGMENT_MIN_SCORE_DEFAULT,
} from '../config.js';

export const INSPECT_IMAGE_TOOL_NAME = 'eokg_inspect_image';

const inputSchema = z.object({
  id: z.string().min(1).max(300).describe('Image source id: a http://data.odeuropa.eu/source/<uuid> URI or bare uuid.'),
  min_score: z.number().min(0).max(1).default(FRAGMENT_MIN_SCORE_DEFAULT)
    .describe(`Hide detector boxes scoring below this (0-1, default ${FRAGMENT_MIN_SCORE_DEFAULT}). Hand-drawn boxes score 1 but are not verified and can carry the wrong label.`),
}).strict();

const box = () => z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const outputSchema = z.object({
  id: z.string(), title: z.string().optional(), artist: z.string().optional(), date: z.string().optional(),
  image_url: z.string(), url: z.string().optional(), original_image_url: z.string().optional(), width: z.number().int().optional(), height: z.number().int().optional(),
  byte_size: z.number().int(), mime_type: z.string(), min_score: z.number(),
  objects: z.array(z.object({
    concept_id: z.string(), label: z.string(), score: z.number(), origin: z.enum(['detector', 'manual', 'unknown']),
    box_pct: box().optional(),
    box_px: box(),
  })),
  hidden_below_min_score: z.number().int(),
  warnings: z.array(z.string()).optional(),
});

const description =
  'Look at an image source, with the smell-related objects detected in it. ' +
  'Returns the picture itself plus each annotated object (vocabulary concept, bounding box as % of width/height from the top-left, and origin: manual boxes were drawn by the Odeuropa team, detector boxes come from an object detector with a confidence score). ' +
  'Detector boxes can be wrong; compare them with what you see. Use these boxes rather than estimating coordinates yourself. ' +
  'The picture is returned to you only; the chat cannot display it, so never embed an image URL as a Markdown image (![](…)). To let the user see it, say it cannot be shown here and give the Record or Image link from the result as a plain link. ' +
  'Takes a source id from eokg_get_source, eokg_get_smell (source.id) or eokg_find_visual_smells.';

const round2 = (n) => Math.round(n * 100) / 100;
const clampPct = (n) => Math.min(100, Math.max(0, n));
const OVERSHOOT_PCT = 2;

function toPct(o, { width, height }) {
  const { x, y, w, h } = o.box_px;
  return {
    x: clampPct(round2((100 * x) / width)), y: clampPct(round2((100 * y) / height)),
    w: clampPct(round2((100 * w) / width)), h: clampPct(round2((100 * h) / height)),
  };
}

function renderText(s) {
  const who = s.artist ? ` by ${s.artist}` : '';
  const when = s.date ? ` (${s.date})` : '';
  const size = s.width ? `${s.width}×${s.height} px, ` : '';
  const lines = [`"${s.title ?? '(untitled)'}"${who}${when}, ${size}${Math.round(s.byte_size / 1000)} KB.`];
  if (s.url) lines.push(`Record: ${s.url}`);
  lines.push(`Image: ${s.image_url}`);
  if (s.original_image_url) lines.push(`Original: ${s.original_image_url}`);
  lines.push('The picture above is for your own analysis; the user does not see it and the chat cannot display it. Give them these as plain links; never embed them as Markdown images, which display blank.');
  const framing = s.width ? 'boxes as % x,y,w,h from top-left' : 'boxes in pixels x,y,w,h from top-left';
  lines.push(`Detected objects (score ≥ ${s.min_score}; ${framing}):`);
  for (const o of s.objects) {
    const b = o.box_pct ?? o.box_px;
    const tag = o.origin === 'manual' ? '(manual)' : `${o.score.toFixed(2)} (${o.origin})`;
    lines.push(`- ${o.label} ${tag} — ${b.x},${b.y},${b.w},${b.h}`);
  }
  if (s.hidden_below_min_score > 0) lines.push(`${s.hidden_below_min_score} lower-scoring detections hidden.`);
  return lines.join('\n');
}

export function registerInspectImageTool(server) {
  server.registerTool(
    INSPECT_IMAGE_TOOL_NAME,
    { title: INSPECT_IMAGE_TOOL_NAME, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS },
    withTool(INSPECT_IMAGE_TOOL_NAME, 'Inspecting the image failed', async (args, ctx) => {
      const id = parseId('source', args.id);
      const signal = ctx?.mcpReq?.signal;
      const metaRows = await sparqlSelect('source_meta', sourceMetaQuery(id), { signal });
      if (!metaRows.length) {
        throw new ToolError(
          `No source found with id ${id}.`,
          'Pass the id exactly as an eokg tool returned it (eokg_get_smell returns it as source.id).',
        );
      }
      const { isImage, imageUrl, originalImageUrl, meta } = shapeSourceMeta(id, metaRows);
      if (!isImage) throw new ToolError('This source is a text, not an image.', 'Use eokg_get_source to read its smells.');
      if (!imageUrl || !IMAGE_URL_RE.test(imageUrl)) {
        throw new ToolError(
          'No locally hosted image for this source.',
          originalImageUrl
            ? `The original is hosted elsewhere and is not fetched; open it yourself: ${originalImageUrl}`
            : 'The graph records no image for it.',
        );
      }

      const [fragRows, { buffer, mimeType }] = await Promise.all([
        sparqlSelect('image_fragments', imageFragmentsQuery(id), { signal }),
        fetchKgImage(imageUrl, { signal }),
      ]);
      const dims = jpegDimensions(buffer);
      const all = shapeFragments(fragRows);
      const kept = all.filter((o) => o.score >= args.min_score);
      const warnings = [];
      const objects = kept.map((o) => (dims ? { ...o, box_pct: toPct(o, dims) } : o));
      if (!dims) {
        warnings.push('Image dimensions could not be read; boxes are given in pixels only.');
      } else {
        if (Math.max(dims.width, dims.height) > VISION_MAX_EDGE) {
          warnings.push(`This image is ${dims.width}×${dims.height} px; your client may downscale it. Percent boxes stay valid.`);
        }
        const over = (o) => (100 * (o.box_px.x + o.box_px.w)) / dims.width > 100 + OVERSHOOT_PCT ||
          (100 * (o.box_px.y + o.box_px.h)) / dims.height > 100 + OVERSHOOT_PCT;
        if (kept.some(over)) {
          warnings.push('Some boxes extend past the image edge; the detector frame may not match this copy.');
        }
      }

      const structured = {
        id,
        ...(meta.title && { title: meta.title }),
        ...(meta.artist && { artist: meta.artist }),
        ...(meta.date && { date: meta.date }),
        image_url: imageUrl,
        ...(meta.url && { url: meta.url }),
        ...(originalImageUrl && { original_image_url: originalImageUrl }),
        ...(dims && { width: dims.width, height: dims.height }),
        byte_size: buffer.length, mime_type: mimeType, min_score: args.min_score,
        objects,
        hidden_below_min_score: all.length - kept.length,
        ...(warnings.length && { warnings }),
      };
      return {
        content: [
          { type: 'image', data: buffer.toString('base64'), mimeType },
          { type: 'text', text: mirrorWarnings(renderText(structured), warnings) },
        ],
        structuredContent: structured,
      };
    }),
  );
}
