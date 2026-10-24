// Pure viewer logic from apps/image-viewer/model.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseResult, errorText, isAllowedImageUrl, initialBoxesOn, toggleContext, labelGroups, selectionContext, clampView,
} from '../apps/image-viewer/model.js';
import { IMAGE_URL_RE } from '../src/config.js';

// Failure modes:
// - the Boxes default flips to on, or a truthy string turns boxes on;
// - the image-host check loses its anchors (lookalike host, http, path tricks);
// - the stdio JSON-block fallback is not read;
// - zoom or pan escapes the frame;
// - context text for the model loses the label list or the manual/detector distinction.

const objects = [
  { label: 'Pipe', score: 0.93, origin: 'detector', box_px: { x: 120, y: 340, w: 80, h: 40 } },
  { label: 'Pipe', score: 0.8, origin: 'detector', box_px: { x: 1, y: 2, w: 3, h: 4 } },
  { label: 'Glass', score: 0.9, origin: 'detector', box_px: { x: 5, y: 6, w: 7, h: 8 } },
  { label: 'Lemon', score: 1, origin: 'manual', box_px: { x: 9, y: 9, w: 9, h: 9 } },
];
const source = { id: 'abc', title: 'Still life' };

test('parseResult reads structuredContent, then the JSON text block, else null', () => {
  const s = { id: 'abc', image_url: 'https://data.odeuropa.eu/image/a.jpg', objects: [] };
  assert.deepEqual(parseResult({ structuredContent: s, content: [] }), s);
  assert.deepEqual(parseResult({ content: [{ type: 'text', text: 'prose' }, { type: 'text', text: JSON.stringify(s) }] }), s);
  assert.equal(parseResult({ content: [{ type: 'text', text: '{"no":"shape"}' }] }), null);
  assert.equal(parseResult({ content: [{ type: 'text', text: '{broken' }] }), null);
  assert.equal(parseResult(undefined), null);
});

test('errorText returns the text of an error result only', () => {
  assert.equal(errorText({ isError: true, content: [{ type: 'text', text: 'No source found' }] }), 'No source found');
  assert.equal(errorText({ content: [{ type: 'text', text: 'fine' }] }), null);
});

test('isAllowedImageUrl accepts only https://data.odeuropa.eu/image/<name>', () => {
  assert.ok(isAllowedImageUrl('https://data.odeuropa.eu/image/e90fb725.jpg'));
  assert.ok(!isAllowedImageUrl('javascript:alert(1)'));
  assert.ok(!isAllowedImageUrl('http://data.odeuropa.eu/image/a.jpg'));
  assert.ok(!isAllowedImageUrl('https://data.odeuropa.eu.evil.com/image/a.jpg'));
  assert.ok(!isAllowedImageUrl('https://data.odeuropa.eu/image/../x'));
  assert.ok(!isAllowedImageUrl('https://evil.com/https://data.odeuropa.eu/image/a.jpg'));
  assert.ok(!isAllowedImageUrl(undefined));
});

// The page carries its own copy of the server's boundary regex; equality is the property.
test('isAllowedImageUrl agrees with the server IMAGE_URL_RE', () => {
  for (const u of [
    'https://data.odeuropa.eu/image/a-b_c.jpg', 'https://data.odeuropa.eu/image/', 'http://data.odeuropa.eu/image/a.jpg',
    'https://data.odeuropa.eu/image/a/b.jpg', 'https://data.odeuropa.eu/image/a.jpg?x=1', 'https://data.odeuropa.eu.evil.com/image/a.jpg',
  ]) assert.equal(isAllowedImageUrl(u), IMAGE_URL_RE.test(u), u);
});

test('initialBoxesOn is true only for boolean true', () => {
  assert.equal(initialBoxesOn({ show_boxes: false }), false);
  assert.equal(initialBoxesOn({}), false);
  assert.equal(initialBoxesOn({ show_boxes: 'true' }), false);
  assert.equal(initialBoxesOn({ show_boxes: true }), true);
});

test('toggleContext names the state, the record and, when on, the labels', () => {
  const on = toggleContext(source, true, objects);
  assert.ok(on.includes('turned the boxes on'));
  assert.ok(on.includes('"Still life" (abc)'));
  assert.ok(on.includes('Pipe ×2, Glass, Lemon (manual)'));
  const off = toggleContext(source, false, objects);
  assert.ok(off.includes('turned the boxes off'));
  assert.ok(!off.includes('Pipe'));
});

test('labelGroups sorts by count then label and flags manual-only labels', () => {
  assert.deepEqual(labelGroups(objects), [
    { label: 'Pipe', count: 2, manual: false },
    { label: 'Glass', count: 1, manual: false },
    { label: 'Lemon', count: 1, manual: true },
  ]);
});

test('selectionContext distinguishes detector and hand-drawn boxes', () => {
  const d = selectionContext(source, objects[0]);
  assert.equal(d, 'User selected a box in the image viewer: "Pipe", score 0.93 (detector), x 120 y 340 w 80 h 40 px, in "Still life" (abc).');
  const m = selectionContext(source, objects[3]);
  assert.ok(m.includes('hand-drawn, not verified'));
  assert.ok(!m.includes('score'));
});

test('clampView limits zoom to 1–8× and keeps the image covering the frame', () => {
  const box = { width: 400, height: 300 };
  assert.deepEqual(clampView(0.2, 50, 50, box), { scale: 1, tx: 0, ty: 0 });
  assert.equal(clampView(20, 0, 0, box).scale, 8);
  assert.deepEqual(clampView(2, 100, 100, box), { scale: 2, tx: 0, ty: 0 });
  assert.deepEqual(clampView(2, -9999, -9999, box), { scale: 2, tx: -400, ty: -300 });
  assert.deepEqual(clampView(2, -120, -50, box), { scale: 2, tx: -120, ty: -50 });
});
