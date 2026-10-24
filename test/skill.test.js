// skill/<name>.skill is a COMMITTED zip of the skill/<name>/ folder — a second copy
// of files whose first copies sit right next to it, and the only form a user can
// actually install. Nothing regenerated it, so it silently froze at a 2026-07-28
// snapshot and shipped the pre-migration vocabulary for a full release: guidance
// that steers a model into filters returning a clean, confident zero.
//
// Same drift class as docs/tools.md quoting the tool descriptions, so it gets the
// same treatment — the folder IS the test's expected value. Fails on a SKILL.md or
// references/ edit that wasn't followed by `npm run build:skill`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkillZip, readSkillFiles, SKILL_BUNDLE, ENTRY_NAME } from '../scripts/build-skill.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = readSkillFiles();
const bundle = readFileSync(join(ROOT, SKILL_BUNDLE));

test('the .skill bundle is a rebuild of the current skill folder', () => {
  // The builder is deterministic across machines (entry timestamp from the
  // frontmatter, not the clock; entries stored, not deflated — see build-skill.mjs),
  // so "what a rebuild would produce" is a legitimate expected value — and
  // comparing bytes catches a hand-edited archive too, not just a stale one.
  assert.deepEqual(
    bundle,
    buildSkillZip(files),
    `${SKILL_BUNDLE} is stale or hand-modified — run \`npm run build:skill\` and commit the result`,
  );
});

test('the .skill bundle is a readable zip holding the skill folder, SKILL.md first', () => {
  // Independent of the builder: parse the archive the way an installer would, so
  // a bug that made buildSkillZip emit consistent GARBAGE can't satisfy both
  // tests at once.
  const entries = readZip(bundle);
  assert.equal(entries[0]?.name, ENTRY_NAME,
    'a skill installs from a folder, so SKILL.md must sit at <name>/SKILL.md');
  assert.deepEqual(entries, files);
});

// --- a minimal zip reader (central-directory first, as a real unzip does) -----
// Deliberately hand-rolled rather than shelling out to `unzip`: the offline suite
// must not depend on a system binary being present.
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(eocd, -1, 'no end-of-central-directory record — not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);

  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, `bad central directory header at entry ${i}`);
    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);

    assert.equal(buf.readUInt32LE(localAt), 0x04034b50, `bad local header for "${name}"`);
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const data = buf.subarray(dataAt, dataAt + compressedSize);
    assert.ok(method === 0 || method === 8, `unexpected compression method ${method} for "${name}"`);
    entries.push({
      name,
      content: (method === 8 ? inflateRawSync(data) : data).toString('utf8'),
    });

    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Hosts reject a skill whose folded `description` exceeds 1,024 characters;
// 1,000 leaves headroom.
test('SKILL.md\'s folded description is at most 1,000 characters', () => {
  const md = readFileSync(join(ROOT, 'skill', 'odeuropa-eokg', 'SKILL.md'), 'utf8');
  const lines = md.split('\n');
  const end = lines.indexOf('---', 1);
  const front = lines.slice(1, end);
  const at = front.findIndex((l) => l.startsWith('description:'));
  assert.notEqual(at, -1, 'no description: line in the frontmatter');
  const inline = front[at].slice('description:'.length).trim();
  let value;
  if (/^[>|]-?$/.test(inline)) {
    const block = [];
    for (const l of front.slice(at + 1)) {
      if (!/^\s/.test(l)) break;
      block.push(l.trim());
    }
    value = block.join(inline.startsWith('|') ? '\n' : ' ');
  } else {
    value = inline.replace(/^(['"])(.*)\1$/, '$2');
  }
  const len = [...value].length;
  assert.ok(len > 0, 'description is empty');
  assert.ok(len <= 1000, `description is ${len} characters; the limit is 1,000`);
});
