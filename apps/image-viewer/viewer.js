import {
  App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts,
} from '@modelcontextprotocol/ext-apps/app-with-deps';
import {
  parseResult, errorText, isAllowedImageUrl, initialBoxesOn, toggleContext, labelGroups, groupText, boxLabel,
  selectionContext, clampView, MIN_SCALE, MAX_SCALE,
} from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#0aa5a5', '#c2a000', '#e0409a'];
const FOOTNOTE = 'Boxes come from the Odeuropa project: hand-drawn ones (dashed) and an object detector\'s (solid, with its score). Both can carry the wrong label.';

const PREVIEW = typeof window !== 'undefined' && window.parent === window;
const root = document.getElementById('root');

const app = PREVIEW ? null : new App(
  { name: 'odeuropa-image-viewer', version: '0.5.0' },
  { availableDisplayModes: ['inline', 'fullscreen'] },
  { autoResize: true },
);

let source = null;
let boxesOn = false;
let selected = null;
let view = { scale: 1, tx: 0, ty: 0 };
let nodes = null;
let displayMode = 'inline';

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, val] of Object.entries(props)) {
    if (k === 'class') e.className = val;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), val);
    else e.setAttribute(k, val);
  }
  e.append(...kids.filter((x) => x != null));
  return e;
};
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, String(val));
  return e;
};

function showStatus(text, isError = false) {
  nodes = null;
  root.replaceChildren(el('p', { id: 'status', role: 'status', class: isError ? 'error' : '' }, text));
  reportSize();
}

function reportSize() {
  if (!app) return;
  requestAnimationFrame(() => {
    app.sendSizeChanged({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight });
  });
}

const sendContext = (text) => {
  if (!app) return;
  app.updateModelContext({ content: [{ type: 'text', text }] }).catch(() => {});
};

const openLink = (url) => {
  if (app) app.openLink({ url }).catch(() => {});
  else window.open(url, '_blank', 'noopener');
};

const colourOf = (label, groups) => PALETTE[groups.findIndex((g) => g.label === label) % PALETTE.length];

function applyView() {
  if (!nodes) return;
  const f = nodes.frame;
  view = clampView(view.scale, view.tx, view.ty, { width: f.clientWidth, height: f.clientHeight });
  nodes.pan.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
}

function zoomAt(factor, cx, cy) {
  const f = nodes.frame;
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const k = next / view.scale;
  const x = cx ?? f.clientWidth / 2;
  const y = cy ?? f.clientHeight / 2;
  view = { scale: next, tx: x - (x - view.tx) * k, ty: y - (y - view.ty) * k };
  applyView();
}

function resetView() {
  view = { scale: 1, tx: 0, ty: 0 };
  applyView();
}

function setBoxes(on, notify) {
  boxesOn = on;
  if (!on) selected = null;
  if (notify) sendContext(toggleContext(source, on, source.objects));
  syncBoxes();
}

function select(i) {
  selected = selected === i ? null : i;
  if (selected != null) sendContext(selectionContext(source, source.objects[selected]));
  syncBoxes();
}

// Updates the parts that depend on boxesOn / selected without rebuilding the image.
function syncBoxes() {
  if (!nodes) return;
  nodes.frame.classList.toggle('boxes-off', !boxesOn); // SVGElement has no `hidden` property
  nodes.legend.hidden = !boxesOn;
  nodes.toggle.setAttribute('aria-pressed', String(boxesOn));
  nodes.svg.querySelectorAll('.box').forEach((g, i) => g.classList.toggle('selected', i === selected));
  nodes.legend.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('selected', selected != null && li.dataset.label === source.objects[selected].label);
  });
  nodes.selection.replaceChildren();
  if (selected != null) {
    const o = source.objects[selected];
    nodes.selection.append(
      el('span', {}, `Selected: ${boxLabel(o)}`),
      el('button', { type: 'button', onclick: () => sendToChat(o) }, 'Send to chat'),
    );
  }
  reportSize();
}

async function sendToChat(o) {
  const b = o.box_px;
  const text = `[Box: ${o.label} in "${source.title ?? '(untitled)'}" (${source.id}), x ${b.x} y ${b.y} w ${b.w} h ${b.h} px]`;
  try {
    await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
  } catch {
    sendContext(selectionContext(source, o));
  }
}

function drawBoxes(svg, groups) {
  const fontSize = Math.max(10, Math.round(svg.viewBox.baseVal.width / 45));
  const tabH = fontSize + 4;
  // The layer may be display:none, where getComputedTextLength() is 0, so measure on a canvas.
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `600 ${fontSize}px ${getComputedStyle(svg).fontFamily}`;
  source.objects.forEach((o, i) => {
    const { x, y, w, h } = o.box_px;
    const g = svgEl('g', { class: `box ${o.origin === 'manual' ? 'manual' : 'detector'}` });
    g.style.color = colourOf(o.label, groups);
    const rect = svgEl('rect', { class: 'outline', x, y, width: w, height: h, stroke: 'currentColor' });
    const title = svgEl('title');
    title.textContent = boxLabel(o);
    // Tab above the box, or just inside it when the box touches the top edge.
    const tabY = y >= tabH ? y - tabH : y;
    const tab = svgEl('rect', { class: 'tab', x: x - 1, y: tabY, width: measure.measureText(o.label).width + 8, height: tabH, rx: 2 });
    const tag = svgEl('text', { x: x + 3, y: tabY + tabH - 4, 'font-size': fontSize, 'pointer-events': 'none' });
    tag.textContent = o.label;
    g.append(title, rect, tab, tag);
    g.addEventListener('click', (ev) => { ev.stopPropagation(); if (!dragMoved) select(i); });
    svg.append(g);
  });
}

let dragMoved = false;

function wireInteraction(frame) {
  frame.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = frame.getBoundingClientRect();
    zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  frame.addEventListener('dblclick', resetView);

  const pointers = new Map();
  let pinch = 0;
  frame.addEventListener('pointerdown', (ev) => {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    dragMoved = false;
    pinch = 0;
  });
  frame.addEventListener('pointermove', (ev) => {
    const prev = pointers.get(ev.pointerId);
    if (!prev) return;
    const cur = { x: ev.clientX, y: ev.clientY };
    pointers.set(ev.pointerId, cur);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) {
        const r = frame.getBoundingClientRect();
        zoomAt(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      }
      pinch = d;
      dragMoved = true;
    } else if (pointers.size === 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      dragMoved ||= Math.hypot(dx, dy) > 2;
      if (view.scale > 1) {
        frame.classList.add('dragging');
        view = { ...view, tx: view.tx + dx, ty: view.ty + dy };
        applyView();
      }
    }
    // Capture only once a drag starts: capture retargets the click to the frame, so a box
    // could never be selected.
    if (dragMoved && !frame.hasPointerCapture(ev.pointerId)) frame.setPointerCapture(ev.pointerId);
  });
  const end = (ev) => {
    pointers.delete(ev.pointerId);
    pinch = 0;
    frame.classList.remove('dragging');
    setTimeout(() => { dragMoved = false; }, 0);
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
}

function onKey(ev) {
  if (!nodes || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.key === 'b') setBoxes(!boxesOn, true);
  else if (ev.key === '+' || ev.key === '=') zoomAt(1.4);
  else if (ev.key === '-' || ev.key === '−') zoomAt(1 / 1.4);
  else if (ev.key === '0') resetView();
}

function toggleFullscreen() {
  const mode = displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  if (!app) return;
  app.requestDisplayMode({ mode }).then((r) => { displayMode = r?.mode ?? displayMode; applyMode(); }).catch(() => {});
}

function applyMode() {
  document.documentElement.classList.toggle('fullscreen', displayMode === 'fullscreen');
  applyView();
  reportSize();
}

function render(result) {
  source = result;
  boxesOn = initialBoxesOn(result);
  selected = null;
  view = { scale: 1, tx: 0, ty: 0 };
  const groups = labelGroups(result.objects);

  const meta = [result.artist, result.date].filter(Boolean).join(', ');
  const header = el('header', {}, el('h1', {}, result.title ?? '(untitled)'), meta ? el('span', { class: 'meta' }, meta) : null);

  const toggle = el('button', { type: 'button', 'aria-pressed': String(boxesOn), onclick: () => setBoxes(!boxesOn, true) },
    `Boxes (${result.objects.length})`);
  toggle.hidden = result.objects.length === 0;
  const toolbar = el('div', { class: 'toolbar' },
    toggle,
    el('button', { type: 'button', onclick: () => zoomAt(1.4), title: 'Zoom in (+)' }, '+'),
    el('button', { type: 'button', onclick: () => zoomAt(1 / 1.4), title: 'Zoom out (−)' }, '−'),
    el('button', { type: 'button', onclick: resetView, title: 'Reset (0)' }, 'Reset'),
    result.url ? el('button', { type: 'button', onclick: () => openLink(result.url), title: 'The original record, with its metadata and image' }, 'Original') : null,
    app ? el('button', { type: 'button', onclick: toggleFullscreen }, 'Fullscreen') : null,
  );

  const legend = el('div', { class: 'legend' },
    el('ul', {}, ...groups.map((g) => el('li', { 'data-label': g.label },
      el('span', { class: 'swatch', style: `background:${colourOf(g.label, groups)}` }),
      groupText(g, 'hand-drawn')))),
    el('p', {}, FOOTNOTE));
  const selection = el('div', { class: 'selection' });

  if (!isAllowedImageUrl(result.image_url)) {
    root.replaceChildren(header, el('p', { id: 'status' }, 'This image cannot be shown here.'),
      result.url ? el('button', { type: 'button', onclick: () => openLink(result.url) }, 'Open the record') : null);
    nodes = null;
    reportSize();
    return;
  }

  const img = el('img', { alt: result.title ?? 'Artwork', src: result.image_url });
  const svg = svgEl('svg', { preserveAspectRatio: 'none', viewBox: '0 0 1 1' });
  const pan = el('div', { class: 'pan' }, img);
  pan.append(svg);
  const frame = el('div', { class: 'frame' }, pan);
  nodes = { frame, pan, svg, legend, toggle, selection };
  img.addEventListener('load', () => {
    svg.setAttribute('viewBox', `0 0 ${img.naturalWidth} ${img.naturalHeight}`);
    frame.style.setProperty('--aspect', String(img.naturalWidth / img.naturalHeight));
    svg.replaceChildren();
    drawBoxes(svg, groups);
    syncBoxes();
    reportSize();
  });
  img.addEventListener('error', () => {
    showStatus('The image could not be loaded.', true);
  });

  wireInteraction(frame);
  root.replaceChildren(header, toolbar, frame, legend, selection);
  syncBoxes();
}

const SAMPLE = {
  id: 'http://data.odeuropa.eu/source/00721405-98be-5795-ac1d-3510448af60a',
  title: 'Still life with fruit', artist: 'Pieter van den Bosch', date: '1650/55XX',
  image_url: 'https://data.odeuropa.eu/image/e90fb725-7275-db43-a805-c109d9b4f9c3.jpg',
  url: 'https://rkd.nl/explore/images/56354', min_score: 0.7, show_boxes: false, hidden_below_min_score: 0,
  objects: [
    ['Lemon', 0.95, 313, 445, 88, 56], ['Peach', 0.95, 206, 417, 77, 78], ['Grape', 0.94, 219, 183, 104, 129],
    ['Glass with stem', 0.94, 323, 303, 85, 146], ['Peach', 0.93, 293, 233, 54, 56], ['Grape', 0.93, 138, 378, 102, 120],
  ].map(([label, score, x, y, w, h], i) => ({
    concept_id: `http://data.odeuropa.eu/vocabulary/olfactory-objects/${i}`, label, score, origin: 'detector', box_px: { x, y, w, h },
  })),
};

function applyHost(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top + 8}px ${right + 12}px ${bottom + 8}px ${left + 12}px`;
  }
  if (ctx.displayMode) { displayMode = ctx.displayMode; applyMode(); }
}

document.addEventListener('keydown', onKey);

if (PREVIEW) {
  const q = new URLSearchParams(window.location.search);
  render({ ...SAMPLE, show_boxes: q.get('boxes') === '1' });
} else {
  // No `tools` capability: the host's tools/list round-trip suppresses ontoolresult on Safari.
  app.ontoolinputpartial = () => showStatus('Loading image…');
  app.ontoolinput = () => showStatus('Loading image…');
  app.ontoolresult = (result) => {
    const err = errorText(result);
    if (err) { showStatus(err, true); return; }
    const parsed = parseResult(result);
    if (parsed) render(parsed);
    else if (!nodes) showStatus('The image could not be opened.', true);
  };
  app.onhostcontextchanged = (params) => applyHost({ ...app.getHostContext(), ...params });
  app.onteardown = async () => ({});
  app.connect().then(() => applyHost(app.getHostContext()));
}
