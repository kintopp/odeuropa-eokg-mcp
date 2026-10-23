#!/usr/bin/env node
// Regenerate the wire-text blocks of docs/tools.md from the running server.
//
// The doc quotes what a client is actually sent — the `instructions` from
// initialize, and each tool's `description` and input schema from listTools — so
// those parts are rendered from the wire rather than kept by hand. Everything
// outside a `<!-- generated:KEY -->` … `<!-- /generated -->` pair is hand-written
// and left untouched. Keys: `instructions`, `<tool>:description`,
// `<tool>:parameters`.
//
// Usage: npm run build:docs   →   docs/tools.md

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DOC_PATH = join(root, 'docs', 'tools.md');

const BLOCK = /<!-- generated:([\w:]+) -->\n[\s\S]*?<!-- \/generated -->/g;

const quote = (text) => text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
const cell = (text) => text.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
const code = (v) => `\`${v === '' ? '""' : v}\``;

function typeOf(schema) {
  if (schema.enum) return `enum: ${schema.enum.map(code).join(' · ')}`;
  if (schema.type === 'array') {
    const item = schema.items?.type === 'integer' ? 'int' : schema.items?.type;
    return schema.minItems === schema.maxItems ? `${item}[${schema.minItems}]` : `${item}[]`;
  }
  const name = { integer: 'int', boolean: 'bool' }[schema.type] ?? schema.type;
  const { minimum: lo, maximum: hi, maxLength } = schema;
  if (maxLength) return `${name} (≤ ${maxLength})`;
  if (lo == null) return name;
  return hi == null || hi === Number.MAX_SAFE_INTEGER ? `${name} (≥ ${lo})` : `${name} (${lo}–${hi})`;
}

function parameterTable(tool, earlier) {
  const { properties = {}, required = [] } = tool.inputSchema;
  const rows = Object.entries(properties).map(([name, schema]) => {
    const fallback = required.includes(name) ? '**required**'
      : 'default' in schema ? code(schema.default) : '—';
    // A parameter identical on the wire to an earlier tool's (the shared
    // narrowing surface) points there instead of repeating its description.
    const same = earlier.find((t) => JSON.stringify(t.inputSchema.properties?.[name]) === JSON.stringify(schema));
    const text = same ? `Same as \`${same.name}\`.` : cell(schema.description ?? '');
    return `| \`${name}\` | ${typeOf(schema)} | ${fallback} | ${text} |`;
  });
  return ['| Param | Type | Default | Description |', '|---|---|---|---|', ...rows].join('\n');
}

/** `doc` with every generated block re-rendered from `instructions` + `tools`. */
export function renderToolsDoc(doc, { instructions, tools }) {
  const blocks = new Map([['instructions', quote(instructions)]]);
  tools.forEach((tool, i) => {
    blocks.set(`${tool.name}:description`, quote(tool.description));
    blocks.set(`${tool.name}:parameters`, parameterTable(tool, tools.slice(0, i)));
  });

  const used = new Set();
  const out = doc.replace(BLOCK, (_, key) => {
    if (!blocks.has(key)) throw new Error(`docs/tools.md has a generated block "${key}" the server does not provide`);
    used.add(key);
    return `<!-- generated:${key} -->\n${blocks.get(key)}\n<!-- /generated -->`;
  });
  const missing = [...blocks.keys()].filter((key) => !used.has(key));
  if (missing.length) {
    throw new Error(`docs/tools.md has no generated block for: ${missing.join(', ')} — add a "## \`eokg_x\`" section with both markers`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  const client = new Client({ name: 'build-docs', version: '0.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [join(root, 'src', 'index.js')], stderr: 'ignore',
  }));
  try {
    const { tools } = await client.listTools();
    const doc = renderToolsDoc(readFileSync(DOC_PATH, 'utf8'), { instructions: client.getInstructions(), tools });
    writeFileSync(DOC_PATH, doc);
    console.error(`docs/tools.md ← server instructions + ${tools.length} tools`);
  } finally {
    await client.close();
  }
}
