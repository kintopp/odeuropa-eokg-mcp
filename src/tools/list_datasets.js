// eokg_list_datasets — the source corpora (named graphs) with a dated smell-count snapshot. No network.

import { z } from 'zod';
import { withTool } from '../lib/tool.js';
import {
  DATASETS, DATASET_GRAPH_BASE, DATASETS_SNAPSHOT_DATE, TOTAL_SMELLS, READ_ONLY_ANNOTATIONS,
} from '../config.js';

export const LIST_DATASETS_TOOL_NAME = 'eokg_list_datasets';

const inputSchema = z.object({}).strict();

export const outputSchema = z.object({
  snapshot_date: z.string(),
  total_smells: z.number().int(),
  datasets: z.array(z.object({
    name: z.string(),
    smells: z.number().int(),
    graph: z.string(),
  })),
});

const description =
  'List the source corpora (datasets) in the knowledge graph, with smell counts. ' +
  'Counts are a dated snapshot; each dataset name is a valid `dataset` filter for eokg_search_smells.';

const fmt = (n) => n.toLocaleString('en-US');

export function registerListDatasetsTool(server) {
  server.registerTool(
    LIST_DATASETS_TOOL_NAME,
    { title: LIST_DATASETS_TOOL_NAME, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS },
    withTool(LIST_DATASETS_TOOL_NAME, 'Listing datasets failed', async () => {
      const structured = {
        snapshot_date: DATASETS_SNAPSHOT_DATE,
        total_smells: TOTAL_SMELLS,
        datasets: DATASETS.map((d) => ({ name: d.name, smells: d.smells, graph: DATASET_GRAPH_BASE + d.name })),
      };
      const text = [
        `${structured.datasets.length} datasets, ${fmt(TOTAL_SMELLS)} smells (snapshot ${DATASETS_SNAPSHOT_DATE}):`,
        ...structured.datasets.map((d) => `${d.name} — ${fmt(d.smells)} smells`),
      ].join('\n');
      return { content: [{ type: 'text', text }], structuredContent: structured };
    }),
  );
}
