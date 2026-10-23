// Builds a fresh McpServer with all tools registered. Used as the serveStdio
// factory — invoked once per connection (and possibly per protocol era), so it
// must be side-effect-free beyond registration. Shared state (caches) belongs
// at module scope in the modules that own it, not here.

import { McpServer } from '@modelcontextprotocol/server';
import { SERVER_NAME, SERVER_VERSION, SERVER_INSTRUCTIONS, CACHE_HINTS } from './config.js';
import { registerListDatasetsTool } from './tools/list_datasets.js';
import { registerGetSmellTool } from './tools/get_smell.js';
import { registerFindConceptsTool } from './tools/find_concepts.js';
import { registerGetConceptTool } from './tools/get_concept.js';
import { registerSearchSmellsTool } from './tools/search_smells.js';
import { registerGetSourceTool } from './tools/get_source.js';
import { registerInspectImageTool } from './tools/inspect_image.js';

export function createServer() {
  // `listChanged` must be an explicit false: the SDK fills an absent value with
  // `true`, and this server never emits notifications/tools/list_changed. A
  // client told "cached for ttlMs, and I'll ping you if that changes" has no
  // correct refresh strategy when the second half is a lie — the TTL in
  // CACHE_HINTS is the only freshness signal here, and must be the only one
  // advertised.
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: SERVER_INSTRUCTIONS,
      cacheHints: CACHE_HINTS,
    },
  );
  registerListDatasetsTool(server);
  registerGetSmellTool(server);
  registerFindConceptsTool(server);
  registerGetConceptTool(server);
  registerSearchSmellsTool(server);
  registerGetSourceTool(server);
  registerInspectImageTool(server);
  return server;
}
