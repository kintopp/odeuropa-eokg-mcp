// Shared test utilities.

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';

// The ONE live-suite gate. Every live test must spell it `{ skip: !LIVE }` (or
// the equivalent `process.env.EOKG_LIVE !== '1'`) — exact equality, never
// truthiness. `skip: !process.env.EOKG_LIVE` reads as the same thing but RUNS
// the live suite for any non-empty value, including the `EOKG_LIVE=0` someone
// would set to turn it off.
export const LIVE = process.env.EOKG_LIVE === '1';

// Backend fixtures for the live (EOKG_LIVE=1) tests.
export const KNOWN_SMELL = 'http://data.odeuropa.eu/smell/7e932a9d-fcd7-5192-a678-ae760d6306ad'; // The Art of Perfumery (1857), lavender
export const KNOWN_IMAGE_SOURCE_IMAGE = 'https://data.odeuropa.eu/image/e90fb725-7275-db43-a805-c109d9b4f9c3.jpg'; // RKD still life, Pieter van den Bosch
export const KNOWN_CONCEPT_ROSE = 'http://data.odeuropa.eu/vocabulary/olfactory-objects/138';

// Validate structuredContent the way a client does: against the tool's advertised
// JSON Schema, where an undeclared key is an additionalProperties violation that
// fails the call. zod's .parse() strips such keys instead, so a parse-based check
// passes a shaper field its outputSchema forgot to declare. Returns the object
// unchanged, so it drops in wherever a test read the result of .parse().
const wireValidator = new AjvJsonSchemaValidator();
export function assertWireValid(outputSchema, structured) {
  const jsonSchema = outputSchema['~standard'].jsonSchema.output({ target: 'draft-2020-12' });
  const { valid, errorMessage } = wireValidator.getValidator(jsonSchema)(structured);
  assert.ok(valid, errorMessage);
  return structured;
}

// A minimal JPEG header (SOI, APP0, SOF0, EOI) that jpegDimensions can read.
export function makeJpeg(width, height) {
  const app0 = Buffer.concat([Buffer.from([0xFF, 0xE0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(9)]);
  const sof = Buffer.alloc(19);
  sof.set([0xFF, 0xC0, 0x00, 0x11, 0x08]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), app0, sof, Buffer.from([0xFF, 0xD9])]);
}

// ── driving the real server as a child process ───────────────────────────────

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_ENTRY = join(ROOT, 'src', 'index.js');

// `env` is merged over process.env for the child — how a test points the server
// at a stub backend (stub-backend.js#startStubServer).
const serverParams = (env) => ({
  command: process.execPath,
  args: [SERVER_ENTRY],
  ...(env && { env: { ...process.env, ...env } }),
});

/**
 * Spawn the real server over stdio, hand `run` a connected client, and close it
 * on every path. `name` only labels the client in the handshake.
 */
export async function withClient(name, run, { env } = {}) {
  const transport = new StdioClientTransport(serverParams(env));
  const client = new Client({ name, version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

// Follows next_offset from offset 0 until has_more is false. Every page must be wire-valid, within
// the per-channel budget, and advance. Returns [{ s, text }] per page.
export async function followPages(callPage, outputSchema) {
  const pages = [];
  let offset = 0;
  for (let guard = 0; guard < 20; guard++) {
    const res = await callPage(offset);
    const s = assertWireValid(outputSchema, res.structuredContent);
    assert.ok(JSON.stringify(s).length <= 60_000, `page at offset ${offset} is over the per-channel budget`);
    pages.push({ s, text: res.content[0].text });
    if (!s.has_more) {
      assert.equal(s.next_offset, undefined, 'next_offset on the last page');
      return pages;
    }
    assert.equal(typeof s.next_offset, 'number', 'has_more without next_offset');
    assert.ok(s.next_offset > offset, `next_offset ${s.next_offset} does not advance past ${offset}`);
    offset = s.next_offset;
  }
  throw new Error('pagination did not terminate');
}

// The first page was trimmed below `limit`, continues right after its last record, and says so in text.
export function assertTrimmedFirstPage([{ s, text }], field, limit) {
  assert.ok(s[field].length < limit, 'the fixture must overflow one page');
  assert.equal(s.next_offset, s[field].length);
  assert.ok(text.includes(`offset ${s.next_offset}`), 'the text channel names the continuation');
}
