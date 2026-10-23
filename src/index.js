#!/usr/bin/env node
// Entry point: serve the Odeuropa EOKG MCP server over stdio.
// stdout is reserved for JSON-RPC — all logging goes to stderr.

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

serveStdio(() => createServer(), {
  onerror: (err) => console.error('[odeuropa-eokg-mcp] transport error:', err),
});

console.error('[odeuropa-eokg-mcp] listening on stdio');
