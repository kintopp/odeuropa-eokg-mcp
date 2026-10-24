// The built page is a committed artefact: these tests catch a stale build and a page that would break in a host iframe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { viewerSourceHash, VIEWER_HTML, STAMP_RE } from '../scripts/viewer-hash.mjs';

const html = readFileSync(VIEWER_HTML, 'utf8');

// Failure modes:
// - viewer sources or the ext-apps version change without a rebuild;
// - an external script/stylesheet makes the page depend on a host CSP it does not have;
// - zod's `new Function("")` probe survives and hangs the viewer in ChatGPT;
// - the protocol code is not bundled, so the page never completes the handshake;
// - the bundle bloats.

test('the built page matches its sources', () => {
  const stamped = STAMP_RE.exec(html)?.[1];
  assert.ok(stamped, 'src/apps/image-viewer.html has no source-hash stamp');
  assert.equal(stamped, viewerSourceHash(),
    'src/apps/image-viewer.html is stale — run npm run build:viewer and commit the result');
});

test('the page is self-contained', () => {
  assert.ok(!/<script[^>]*\ssrc=/.test(html), 'external <script src>');
  assert.ok(!/<link[^>]*rel=["']stylesheet["'][^>]*href=/.test(html), 'external stylesheet');
  for (const host of ['unpkg.com', 'jsdelivr', 'cdnjs', 'esm.sh']) assert.ok(!html.includes(host), host);
});

test('no eval probe survives', () => {
  assert.ok(!/Function\(\s*(""|''|``)\s*\)/.test(html));
});

test('the ext-apps protocol code is bundled', () => {
  assert.ok(html.includes('ui/initialize'));
});

test('the page stays under 650 KB', () => {
  assert.ok(statSync(VIEWER_HTML).size < 650 * 1024);
});
