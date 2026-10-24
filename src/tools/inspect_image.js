// eokg_inspect_image — the picture of an image source plus its annotated objects, boxes as % of the frame.

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import { parseId } from '../lib/ids.js';
import { jpegDimensions } from '../lib/jpeg.js';
import { mirrorWarnings } from '../lib/warnings.js';
import { fetchKgImage } from '../image/client.js';
import { lookupHostedImage, scoredFragments, imageInputFields, imageLinkLines } from './get_source.js';
import { READ_ONLY_ANNOTATIONS, VISION_MAX_EDGE } from '../config.js';

export const INSPECT_IMAGE_TOOL_NAME = 'eokg_inspect_image';

const inputSchema = z.object(imageInputFields()).strict();

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
  'The picture is returned to you only. To show it to the user, call eokg_view_image; never embed an image URL as a Markdown image (![](…)). ' +
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
  lines.push(...imageLinkLines(s));
  lines.push('The picture above is for your own analysis; the user does not see it. To show it, call eokg_view_image; never embed these links as Markdown images, which display blank.');
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
      const signal = ctx?.mcpReq?.signal;
      const { header, warnings } = await lookupHostedImage(parseId('source', args.id), signal);

      const [{ objects: kept, hidden }, { buffer, mimeType }] = await Promise.all([
        scoredFragments(header.id, args.min_score, signal),
        fetchKgImage(header.image_url, { signal }),
      ]);
      const dims = jpegDimensions(buffer);
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
        ...header,
        ...(dims && { width: dims.width, height: dims.height }),
        byte_size: buffer.length, mime_type: mimeType, min_score: args.min_score,
        objects,
        hidden_below_min_score: hidden,
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
