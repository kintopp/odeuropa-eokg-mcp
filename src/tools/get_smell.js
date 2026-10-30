// eokg_get_smell — one smell reference with its source and extracted roles.

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import { ToolError } from '../lib/errors.js';
import { parseId, uuidOf, explorerUrl, isLocal, KG_BASE } from '../lib/ids.js';
import { pickLabel, labelFromUri, collectByUri, uniqueStrings } from '../lib/rdf.js';
import { capArrays, truncateText } from '../lib/budget.js';
import { withWarnings } from '../lib/warnings.js';
import { prune } from '../lib/prune.js';
import { sparqlSelect, v } from '../sparql/client.js';
import { smellCoreQuery, smellExcerptsQuery, smellRolesQuery } from '../sparql/queries/smell.js';
import { sourceExistsQuery } from '../sparql/queries/source.js';
import {
  READ_ONLY_ANNOTATIONS, DATASET_GRAPH_BASE, EXCERPT_INJECTION_BOUNDARY, EXCERPT_MAX_CHARS,
  SMELL_MAX_EXCERPTS, PER_CHANNEL_RESULT_BUDGET,
} from '../config.js';

export const GET_SMELL_TOOL_NAME = 'eokg_get_smell';

const inputSchema = z.object({
  id: z.string().min(1).max(300).describe(
    'Smell id: the http://data.odeuropa.eu/smell/<uuid> URI, the bare uuid, or an Explorer /smells/<uuid> link.',
  ),
}).strict();

const idLabel = () => z.object({ id: z.string(), label: z.string() });

export const outputSchema = z.object({
  id: z.string(), explorer_url: z.string(), dataset: z.string(),
  source: z.object({
    id: z.string(), type: z.enum(['text', 'image']), title: z.string().optional(), url: z.string().optional(),
    language: z.string().optional(), date: z.string().optional(), author: z.string().optional(),
    artist: z.string().optional(), license: z.string().optional(), genre: z.string().optional(),
    images: z.array(z.string()).optional(),
  }),
  excerpts: z.array(z.string()),
  smell_sources: z.array(idLabel()),
  mentions: z.array(z.string()),
  carriers: z.array(idLabel()),
  carrier_mentions: z.array(z.string()),
  times: z.array(z.string()),
  gestures: z.array(idLabel()),
  places: z.array(idLabel()),
  perceivers: z.array(z.string()), emotions: z.array(z.string()),
  qualities: z.array(idLabel()),
  truncated: z.record(z.string(), z.number().int()).optional(),
  warnings: z.array(z.string()).optional(),
});

const description =
  'Get one smell reference: its source text or image, excerpt and extracted roles. ' +
  'Roles are machine-extracted: smell source (vocabulary concept plus the words used), carrier (vocabulary concept in carriers, the words used in carrier_mentions), gesture, time, place, perceiver, emotions, qualities. ' +
  'A carrier id works in eokg_smell_profile, which counts that concept as a smell source or space, not as a carrier. ' +
  'Emotions are inferred by a classifier, not stated in the text. Ids come from eokg_search_smells, eokg_get_source or eokg_find_visual_smells.';

const IMAGE_WARNING = 'This smell was detected in an image, so there is no text excerpt; source.images links the picture.';
const IMAGE_BASE = 'https://data.odeuropa.eu/image/';

const terms = (rows, key) => rows.map((r) => r[key]).filter(Boolean);

function shapeSource(core) {
  const first = core[0];
  const images = uniqueStrings(core.map((r) => v(r, 'image')));
  images.sort((a, b) => Number(b.startsWith(IMAGE_BASE)) - Number(a.startsWith(IMAGE_BASE)));
  const one = (key) => v(first, key) ?? core.map((r) => v(r, key)).find(Boolean);
  return prune({
    id: v(first, 'source'),
    type: v(first, 'type').endsWith('E36_Visual_Item') ? 'image' : 'text',
    title: pickLabel(terms(core, 'title')),
    url: one('url'), language: one('lang'), date: one('date'), author: one('author'),
    artist: one('artist'), license: one('license'), genre: one('genre'), images,
  });
}

// Blank-node and local values are kept; sameAs twins (other hosts) are dropped.
const keep = (r) => r.val?.type === 'bnode' || isLocal(r.val?.value);

function shapeRoles(rows) {
  const by = (role) => rows.filter((r) => v(r, 'role') === role);
  const labels = (role) => uniqueStrings(by(role).filter(keep).map((r) => v(r, 'valLabel')));
  const concepts = (role) => collectByUri(by(role).filter((r) => v(r, 'val')?.startsWith(`${KG_BASE}vocabulary/`)), 'val', 'valLabel');
  const words = (role) => uniqueStrings(by(role).filter((r) => v(r, 'val')?.startsWith(`${KG_BASE}object/`)).map((r) => v(r, 'valLabel')));
  const withFallback = (role) => collectByUri(by(role), 'val', 'valLabel');
  return {
    smell_sources: concepts('source'),
    mentions: words('source'),
    carriers: concepts('carrier'),
    carrier_mentions: words('carrier'),
    times: labels('time'),
    gestures: withFallback('gesture'),
    perceivers: labels('perceiver'),
    places: withFallback('place'),
    emotions: uniqueStrings(by('emotion').filter(keep).map((r) => v(r, 'valLabel') ?? labelFromUri(v(r, 'val')))),
    qualities: withFallback('quality'),
  };
}

function conceptsAndWords(concepts, words) {
  const named = concepts.map((c) => `${c.label} [${c.id.slice(`${KG_BASE}vocabulary/`.length)}]`).join(', ');
  const used = words.map((w) => `"${w}"`).join(', ');
  return [named, used && `words used: ${used}`].filter(Boolean).join('; ');
}

function renderText(s, uuid) {
  const src = s.source;
  const who = src.author ?? src.artist;
  const meta = [src.date, src.language].filter(Boolean).join(', ');
  const lines = [
    `Smell ${uuid} — ${s.dataset}`,
    `Source (${src.type}): ${src.title ?? '(untitled)'}${meta ? ` (${meta})` : ''}${who ? ` by ${who}` : ''}`,
    src.url ? `  ${src.url}` : undefined,
  ];
  const smellSource = conceptsAndWords(s.smell_sources, s.mentions);
  if (smellSource) lines.push(`Smell source: ${smellSource}`);
  const carrier = conceptsAndWords(s.carriers, s.carrier_mentions);
  const joined = (label, xs) => (xs.length ? `${label}: ${xs.join(', ')}` : undefined);
  const ctx = [
    joined('Time', s.times), joined('Place', s.places.map((p) => p.label)),
    carrier && `Carrier: ${carrier}`, joined('Gesture', s.gestures.map((g) => g.label)), joined('Perceiver', s.perceivers),
  ].filter(Boolean).join(' · ') || undefined;
  lines.push(
    ctx,
    joined('Emotions (machine-inferred)', s.emotions),
    joined('Qualities', s.qualities.map((q) => q.label)),
    `Explorer: ${s.explorer_url}`,
  );
  if (s.excerpts.length) lines.push('', EXCERPT_INJECTION_BOUNDARY, ...s.excerpts.map((e) => `«${e}»`));
  return lines.filter((l) => l !== undefined && l !== false).join('\n');
}

export function registerGetSmellTool(server) {
  server.registerTool(
    GET_SMELL_TOOL_NAME,
    { title: GET_SMELL_TOOL_NAME, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS },
    withTool(GET_SMELL_TOOL_NAME, 'Getting the smell failed', async (args, ctx) => {
      const id = parseId('smell', args.id);
      const signal = ctx?.mcpReq?.signal;
      const [core, excerptRows, roleRows] = await Promise.all([
        sparqlSelect('smell_core', smellCoreQuery(id), { signal }),
        sparqlSelect('smell_excerpts', smellExcerptsQuery(id), { signal }),
        sparqlSelect('smell_roles', smellRolesQuery(id), { signal }),
      ]);
      if (!core.length) {
        const uuid = uuidOf(id);
        const asSource = uuid && await sparqlSelect('source_exists', sourceExistsQuery(parseId('source', uuid)), { signal });
        if (asSource?.length) {
          throw new ToolError(`${uuid} is a source id, not a smell id.`, 'Use eokg_get_source to list its smells.');
        }
        throw new ToolError(
          `No smell found with id ${id}.`,
          'Pass the id exactly as an eokg tool returned it; re-run the search that produced it.',
        );
      }
      const warnings = [];
      const source = shapeSource(core);
      const excerpts = excerptRows.slice(0, SMELL_MAX_EXCERPTS)
        .map((r) => truncateText(v(r, 'text'), EXCERPT_MAX_CHARS));
      if (excerptRows.length > SMELL_MAX_EXCERPTS) {
        warnings.push(`More than ${SMELL_MAX_EXCERPTS} excerpts reference this smell; only the first ${SMELL_MAX_EXCERPTS} are shown.`);
      }
      if (source.type === 'image' && !excerpts.length) warnings.push(IMAGE_WARNING);

      const full = {
        id,
        explorer_url: explorerUrl('smell', id),
        dataset: v(core[0], 'graph').slice(DATASET_GRAPH_BASE.length),
        source,
        excerpts,
        ...shapeRoles(roleRows),
      };
      const structured = capArrays(full, ['carrier_mentions', 'excerpts', 'qualities', 'emotions', 'places', 'carriers'], PER_CHANNEL_RESULT_BUDGET);
      const text = renderText(structured, uuidOf(id));
      const res = withWarnings({ structured, text }, warnings);
      return { content: [{ type: 'text', text: res.text }], structuredContent: res.structured };
    }),
  );
}
