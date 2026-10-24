#!/usr/bin/env node
// Repack the skill/<name>/ folder (SKILL.md + references/) into the installable
// skill/<name>.skill zip.
//
// The .skill file is a COMMITTED artifact, not a dist/ build output — it is what
// someone downloads from the repo to install the skill — so a rebuild that
// changes nothing must produce byte-identical output on ANY machine, or every run
// dirties the working tree. Hence: no system `zip` (its output embeds the current
// clock and varies by implementation), a hand-rolled archive, an
// entry timestamp taken from SKILL.md's own `last_updated:` frontmatter rather
// than from the filesystem (mtimes are set by `git clone`, so a checkout-derived
// timestamp would differ per machine), and entries STORED rather than deflated:
// DEFLATE output is not stable across zlib builds — a shared system zlib and
// Node's bundled one compress the same input to different byte counts, which is
// exactly a CI-vs-laptop mismatch. Content in, bytes out.
//
// Usage: npm run build:skill   →   skill/odeuropa-eokg.skill

import { crc32 } from 'node:zlib';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SKILL_NAME = 'odeuropa-eokg';
export const SKILL_DIR = join('skill', SKILL_NAME);
export const SKILL_SOURCE = join(SKILL_DIR, 'SKILL.md');
export const SKILL_BUNDLE = join('skill', `${SKILL_NAME}.skill`);
// Paths INSIDE the archive. Claude installs a skill from a folder, so every
// entry must carry that folder level — a bare SKILL.md at the root will not load.
export const ENTRY_NAME = `${SKILL_NAME}/SKILL.md`;

/**
 * Every file in the skill folder as [{ name, content }], `name` being its
 * archive path. SKILL.md first, the rest in byte order (never locale order,
 * which varies by machine); dotfiles such as a Finder `.DS_Store` are skipped.
 */
export function readSkillFiles(dir = join(root, SKILL_DIR)) {
  const rels = readdirSync(dir, { recursive: true })
    .map((rel) => String(rel).split(sep).join('/'))
    .filter((rel) => !rel.split('/').some((seg) => seg.startsWith('.')))
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a < b ? -1 : a > b ? 1 : 0));
  return rels.map((rel) => {
    const content = readFileSync(join(dir, rel), 'utf8');
    return { name: `${SKILL_NAME}/${rel}`, content: rel === 'SKILL.md' ? stampVersion(content) : content };
  });
}

// The skill's `version:` tracks the server's, so it is written from package.json
// at build time rather than kept by hand in SKILL.md.
function stampVersion(md) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const stamped = md.replace(/^(name:.*\n)/m, `$1version: ${version}\n`);
  if (stamped === md) throw new Error(`${SKILL_SOURCE} has no \`name:\` frontmatter line to stamp the version after`);
  return stamped;
}

/** `last_updated: YYYY-MM-DD` from the frontmatter, as {year, month, day}. */
function frontmatterDate(md) {
  const m = md.match(/^last_updated:\s*(\d{4})-(\d{2})-(\d{2})\s*$/m);
  if (!m) {
    throw new Error(`${SKILL_SOURCE} has no \`last_updated: YYYY-MM-DD\` frontmatter field to date the archive with`);
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * Build the zip for `files` (from readSkillFiles), every entry dated from
 * SKILL.md's frontmatter — the first file.
 */
export function buildSkillZip(files) {
  const { year, month, day } = frontmatterDate(files[0].content);
  // MS-DOS date/time, the only timestamp a base zip entry has. Midnight, since
  // the frontmatter carries no time of day.
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = 0;

  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.content, 'utf8');
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);   // version needed: 1.0 — stored entry, no features
    local.writeUInt16LE(0, 6);    // flags
    local.writeUInt16LE(0, 8);    // method: stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(raw.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);   // extra field length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: UNIX, so the mode below is read
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(raw.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 30);     // extra + comment length
    central.writeUInt32LE(0, 34);     // disk start + internal attrs
    // External attrs: regular file, 0644. `>>> 0` because the shift overflows into
    // a negative int32 and writeUInt32LE rejects it.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42); // this entry's local header

    locals.push(local, name, raw);
    centrals.push(central, name);
    offset += local.length + name.length + raw.length;
  }
  const cd = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt32LE(0, 4);      // this disk + cd start disk
  eocd.writeUInt16LE(files.length, 8);   // entries on this disk
  eocd.writeUInt16LE(files.length, 10);  // entries total
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);     // comment length

  return Buffer.concat([...locals, cd, eocd]);
}

// Only rebuild when run directly — the exports above back test/skill.test.js.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = readSkillFiles();
  const zip = buildSkillZip(files);
  writeFileSync(join(root, SKILL_BUNDLE), zip);
  console.log(`${SKILL_BUNDLE} ← ${SKILL_DIR}/ (${files.length} files, ${zip.length} bytes)`);
}
