// Protocol-level smoke test: spawns the REAL server over stdio via the MCP client
// SDK and asserts the tool contract. Offline: eokg_list_datasets needs no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputSchema as listDatasetsOutput } from '../src/tools/list_datasets.js';
import { withClient, assertWireValid } from './helpers.js';

// Every registered tool must be listed here (the count is asserted below).
const REQUIRED_PROPS = {
  eokg_list_datasets: [],
  eokg_get_smell: ['id'],
  eokg_find_concepts: [],
  eokg_get_concept: ['id'],
  eokg_search_smells: ['text'],
};

test('exposes the expected tools with strict, $ref-free input schemas', async () => {
  await withClient('eokg-smoke', async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    for (const [name, props] of Object.entries(REQUIRED_PROPS)) {
      assert.ok(names.includes(name), `expected ${name}; got: ${names.join(', ') || '(none)'}`);
      const tool = tools.find((t) => t.name === name);

      // Complete four-hint annotation block, not just readOnlyHint.
      const ann = tool.annotations || {};
      assert.equal(ann.readOnlyHint, true, `${name} should set readOnlyHint:true`);
      assert.equal(ann.destructiveHint, false, `${name} should set destructiveHint:false`);
      assert.equal(ann.idempotentHint, true, `${name} should set idempotentHint:true`);
      assert.equal(ann.openWorldHint, true, `${name} should set openWorldHint:true`);

      const schema = tool.inputSchema;
      assert.equal(schema.type, 'object', `${name} schema should be an object`);
      assert.equal(schema.additionalProperties, false, `${name} input schema should be strict`);
      assert.ok(!JSON.stringify(schema).includes('$ref'), `${name} input schema must be $ref-free`);
      for (const prop of props) {
        assert.ok(schema.properties?.[prop], `${name} input schema missing property: ${prop}`);
      }

      // Every tool declares an outputSchema, and it must be $ref-free too.
      const out = tool.outputSchema;
      assert.ok(out && out.type === 'object', `${name} should declare an object outputSchema`);
      assert.ok(!JSON.stringify(out).includes('$ref'), `${name} output schema must be $ref-free`);
    }
  });
});

test('every registered tool is listed in REQUIRED_PROPS', async () => {
  await withClient('eokg-smoke', async (client) => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, Object.keys(REQUIRED_PROPS).length,
      `registered: ${tools.map((t) => t.name).join(', ')}`);
  });
});

// Gloss-truncation guard: hosts truncate each tool's description in the tool
// list, and the tightest budget we've measured is the deferred-tool catalogue
// gloss (tool-search surfacing) at 79 content chars + a 1-char ellipsis. So the
// FIRST sentence must be a complete, self-contained summary within 79 chars —
// the rest is read only once the model has chosen the tool. The split is on the
// first ". " (period+space), so a lead must carry no earlier sentence break
// (no "e.g. "/"etc. "). Measure code points (characters), not bytes.
const GLOSS_BUDGET = 79;
test('every tool description opens with a complete sentence within the gloss budget', async () => {
  await withClient('eokg-smoke', async (client) => {
    const { tools } = await client.listTools();
    for (const t of tools) {
      const desc = t.description || '';
      const i = desc.indexOf('. ');
      const lead = i === -1 ? desc : desc.slice(0, i + 1);
      const len = [...lead].length;
      assert.ok(lead.trimEnd().endsWith('.'), `${t.name}: description must open with a complete sentence`);
      assert.ok(
        len <= GLOSS_BUDGET,
        `${t.name}: first sentence is ${len} chars; must be <= ${GLOSS_BUDGET} (deferred-gloss budget)`,
      );
    }
  });
});

test('eokg_list_datasets returns 21 datasets, wire-valid, with the snapshot date', async () => {
  await withClient('eokg-smoke', async (client) => {
    const res = await client.callTool({ name: 'eokg_list_datasets', arguments: {} });
    assert.notEqual(res.isError, true, `tool errored: ${res.content?.[0]?.text}`);
    assertWireValid(listDatasetsOutput, res.structuredContent);
    assert.equal(res.structuredContent.datasets.length, 21);
    assert.equal(res.structuredContent.total_smells, 2445713);
    assert.ok(res.structuredContent.datasets.every((d) => d.graph === `http://data.odeuropa.eu/${d.name}`));
    const text = res.content[0].text;
    assert.ok(text.includes('snapshot 2026-10-23'));
    assert.ok(text.includes('21 datasets, 2,445,713 smells'));
    assert.ok(text.includes('medical-heritage — 898,458 smells'));
  });
});

test('the model-facing description names the dataset filter', async () => {
  await withClient('eokg-smoke', async (client) => {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === 'eokg_list_datasets');
    assert.match(t.description, /dated snapshot/);
    assert.match(t.description, /eokg_search_smells/);
  });
});

test('serverInfo carries the machine name and no human-readable title', async () => {
  await withClient('eokg-smoke', async (client) => {
    const info = client.getServerVersion();
    assert.equal(info.name, 'odeuropa-eokg-mcp');
    assert.equal(info.title, undefined);
  });
});
