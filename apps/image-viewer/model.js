// Pure viewer logic (no DOM), so node --test can cover it.

const isResult = (o) => o && typeof o === 'object' && typeof o.id === 'string' && typeof o.image_url === 'string';

export function parseResult(result) {
  if (isResult(result?.structuredContent)) return result.structuredContent;
  for (const block of result?.content ?? []) {
    if (block?.type !== 'text' || typeof block.text !== 'string' || !block.text.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(block.text);
      if (isResult(parsed)) return parsed;
    } catch { /* not the JSON block */ }
  }
  return null;
}

export function errorText(result) {
  if (!result?.isError) return null;
  const t = (result.content ?? []).find((b) => b?.type === 'text' && typeof b.text === 'string');
  return t ? t.text : 'The image could not be opened.';
}

// Same pattern as IMAGE_URL_RE in src/config.js; the page cannot import server code.
const IMAGE_URL_RE = /^https:\/\/data\.odeuropa\.eu\/image\/[A-Za-z0-9._~%-]+$/;
export const isAllowedImageUrl = (url) => typeof url === 'string' && IMAGE_URL_RE.test(url);

export const initialBoxesOn = (result) => result?.show_boxes === true;

export function labelGroups(objects) {
  const groups = new Map();
  for (const o of objects ?? []) {
    const g = groups.get(o.label) ?? { label: o.label, count: 0, manual: true };
    g.count++;
    if (o.origin !== 'manual') g.manual = false;
    groups.set(o.label, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const groupText = (g) => `${g.label}${g.count > 1 ? ` ×${g.count}` : ''}${g.manual ? ' (manual)' : ''}`;
const named = (source) => `"${source.title ?? '(untitled)'}" (${source.id})`;

export function toggleContext(source, on, objects) {
  if (!on) return `User turned the boxes off in the image viewer for ${named(source)}.`;
  return `User turned the boxes on in the image viewer for ${named(source)}: ${labelGroups(objects).map(groupText).join(', ')}.`;
}

export function selectionContext(source, obj) {
  const { x, y, w, h } = obj.box_px;
  const how = obj.origin === 'manual' ? 'hand-drawn, not verified' : `score ${obj.score.toFixed(2)} (${obj.origin})`;
  return `User selected a box in the image viewer: "${obj.label}", ${how}, x ${x} y ${y} w ${w} h ${h} px, in ${named(source)}.`;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

// box = { width, height } of the frame; the image fills it at scale 1, so the pan range is frame * (scale - 1).
export function clampView(scale, tx, ty, box) {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  const clamp = (t, size) => Math.min(0, Math.max(size * (1 - s), t));
  return { scale: s, tx: clamp(tx, box.width), ty: clamp(ty, box.height) };
}
