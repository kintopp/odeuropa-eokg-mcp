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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPluginZips, buildSkillZip, readSkillFiles, SKILL_BUNDLE, ENTRY_NAME } from '../scripts/build-skill.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = readSkillFiles();
const bundle = readFileSync(join(ROOT, SKILL_BUNDLE));
const skillMd = files.find((f) => f.name === ENTRY_NAME).content;
// Field checks read only this: the same text in the body must not satisfy them.
const frontmatter = skillMd.slice(0, skillMd.indexOf('\n---\n'));

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

test('skill/odeuropa-eokg.zip is a byte-identical copy of the .skill', () => {
  // The path is spelled out because the README links to it.
  assert.deepEqual(readFileSync(join(ROOT, 'skill', 'odeuropa-eokg.zip')), bundle,
    'skill/odeuropa-eokg.zip is stale — run `npm run build:skill` and commit the result');
});

test('SKILL.md carries package.json\'s version in its source and bundle', () => {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const source = readFileSync(join(ROOT, 'skill', 'odeuropa-eokg', 'SKILL.md'), 'utf8');
  assert.match(source, new RegExp(`^ {2}version: "${version.replaceAll('.', '\\.')}"$`, 'm'),
    'run `npm run build:skill` and commit the result');
  assert.equal(files.find((f) => f.name === ENTRY_NAME).content, source);
});

// Their values are per-server choices, so only presence and the spec's cap are checked.
test('SKILL.md declares a license and a compatibility of at most 500 characters', () => {
  assert.match(frontmatter, /^license: \S/m);
  const compatibility = /^compatibility: (.+)$/m.exec(frontmatter)?.[1] ?? '';
  assert.ok(compatibility.length >= 1 && compatibility.length <= 500, `compatibility is ${compatibility.length} characters`);
});

test('a look-alike line in the SKILL.md body never stands in for a frontmatter field', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const read = (md) => {
    writeFileSync(join(dir, 'SKILL.md'), md);
    return readSkillFiles(dir);
  };
  const body = '\n  version: "9.9.9"\n  last_updated: "1999-01-01"\n';

  const stamped = read(`---\nname: x\nmetadata:\n  version: "0"\n  last_updated: "2026-01-01"\n---${body}`);
  assert.ok(stamped[0].content.endsWith(`---${body}`), 'the body must survive a stamp unchanged');
  assert.ok(!stamped[0].content.includes('version: "0"'), 'the frontmatter version must be the one stamped');
  assert.equal(readZip(buildSkillZip(stamped))[0].content, stamped[0].content);

  assert.throws(() => read(`---\nname: x\n---${body}`), /metadata\.version/);
  const undated = read(`---\nname: x\nmetadata:\n  version: "0"\n---${body}`);
  assert.throws(() => buildSkillZip(undated), /metadata\.last_updated/);
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

// Hosts reject a skill whose frontmatter has any other top-level key; extra
// fields (version, last_updated) belong under `metadata:` as strings.
test('the bundled SKILL.md frontmatter uses only keys hosts accept', () => {
  const front = frontmatter.split('\n').slice(1);
  const allowed =['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility'];
  for (const l of front.filter((x) => /^[^\s#]/.test(x))) {
    const key = l.slice(0, l.indexOf(':'));
    assert.ok(allowed.includes(key), `frontmatter key "${key}" is not one of ${allowed.join(', ')}`);
  }
  for (const l of front.filter((x) => /^\s+\S/.test(x) && !/^\s+description/.test(x))) {
    assert.match(l, /^\s+[\w-]+: ".*"$/, `metadata value must be a quoted string: ${l.trim()}`);
  }
});

// The place recipe answers "which smells occur there"; only smell_sources counts smell
// sources, while qualities describe how they smell.
test('the place-type recipe requests the smell_sources facet its answer needs', () => {
  const md = readFileSync(join(ROOT, 'skill', 'odeuropa-eokg', 'SKILL.md'), 'utf8');
  const section = /### \d+\. Smells of a place type\n([\s\S]*?)\n###/.exec(md)?.[1];
  assert.ok(section, 'no "Smells of a place type" recipe');
  const call = /eokg_smell_profile\(\{[^}]*facets: \[([^\]]*)\][^}]*\}\)/.exec(section);
  assert.ok(call, 'the recipe has no eokg_smell_profile call with facets');
  assert.ok(call[1].includes('"smell_sources"'), `facets are [${call[1]}]`);
});

// --- plugin/odeuropa-eokg/: what a marketplace installs on Claude and ChatGPT ---
// A git-subdir install sees only this folder, so the skill there is a real copy.

const PLUGIN = join(ROOT, 'plugin', 'odeuropa-eokg');
const readJson = (...p) => JSON.parse(readFileSync(join(PLUGIN, ...p), 'utf8'));

function listFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((rel) => !rel.split(sep).some((seg) => seg.startsWith('.')))
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .sort()
    .map((rel) => [rel.split(sep).join('/'), readFileSync(join(dir, rel), 'utf8')]);
}

test('the plugin carries an exact copy of the skill folder', () => {
  assert.deepEqual(
    listFiles(join(PLUGIN, 'skills', 'odeuropa-eokg')),
    listFiles(join(ROOT, 'skill', 'odeuropa-eokg')),
    'plugin/odeuropa-eokg/skills/ is stale — run `npm run build:skill` and commit the result',
  );
});

test('both plugin manifests name the plugin and carry package.json\'s version', () => {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const claude = readJson('.claude-plugin', 'plugin.json');
  const portable = readJson('plugin.json');
  for (const m of [claude, portable]) {
    assert.equal(m.name, 'odeuropa-eokg');
    assert.equal(m.version, version, 'run `npm run build:skill` and commit the result');
  }
  assert.equal(claude.displayName, 'Odeuropa EOKG');
  assert.equal(portable.extensions?.['com.openai']?.interface?.displayName, 'Odeuropa EOKG');
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
});

// Claude reads .mcp.json with type "http"; the Agent Plugins schema behind mcp.json
// calls the same transport "streamable-http" and allows no other server keys.
// The key is the connector's label: Claude shows it as written and ChatGPT capitalises
// its first letter, and neither allows a space, so "Odeuropa-EOKG" reads the same on both.
test('both MCP configs point at the hosted server', () => {
  const url = 'https://odeuropa-eokg-mcp-production.up.railway.app/mcp';
  assert.deepEqual(readJson('.mcp.json').mcpServers, { 'Odeuropa-EOKG': { type: 'http', url } });
  const portable = readJson('mcp.json');
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.deepEqual(portable.mcpServers, { 'Odeuropa-EOKG': { type: 'streamable-http', url } });
});

test('the plugin has no top-level bin/ directory, which claude.ai refuses', () => {
  assert.ok(!existsSync(join(PLUGIN, 'bin')));
});

// ChatGPT cuts it off after 57 characters and shows the rest only on hover.
test('the ChatGPT short description is at most 57 characters', () => {
  const short = readJson('plugin.json').extensions?.['com.openai']?.interface?.shortDescription ?? '';
  assert.ok(short.length >= 1 && [...short].length <= 57, `"${short}" is ${[...short].length} characters`);
});

// One upload zip per platform, its files at the root: Claude refuses an archive
// holding more than one plugin.json, and a nested folder hides the manifest.
const UPLOADS = {
  claude: ['.claude-plugin/plugin.json', '.mcp.json'],
  chatgpt: ['plugin.json', 'mcp.json'],
};
for (const [platform, configs] of Object.entries(UPLOADS)) {
  const zipPath = join(ROOT, 'plugin', `odeuropa-eokg-${platform}.zip`);

  test(`the ${platform} upload zip is a rebuild of the plugin folder`, () => {
    assert.ok(existsSync(zipPath), `${zipPath} is missing — run \`npm run build:skill\``);
    assert.deepEqual(readFileSync(zipPath), buildPluginZips(files)[platform],
      `plugin/odeuropa-eokg-${platform}.zip is stale — run \`npm run build:skill\` and commit the result`);
  });

  test(`the ${platform} upload zip holds only its platform's files, matching the plugin folder`, () => {
    const entries = readZip(readFileSync(zipPath));
    const skill = listFiles(join(ROOT, 'skill', 'odeuropa-eokg'))
      .map(([rel]) => `skills/odeuropa-eokg/${rel}`)
      // Claude ignores agents/openai.yaml, ChatGPT's skill label.
      .filter((rel) => platform === 'chatgpt' || !rel.includes('/agents/'));
    assert.deepEqual(entries.map((e) => e.name).sort(), [...configs, ...skill].sort());
    for (const { name, content } of entries) {
      assert.equal(content, readFileSync(join(PLUGIN, name), 'utf8'), `${name} differs from plugin/odeuropa-eokg/${name}`);
    }
  });
}

// ChatGPT otherwise title-cases the skill's name into "Odeuropa Eokg".
test('the skill gives ChatGPT the display name "Odeuropa EOKG"', () => {
  const yaml = readFileSync(join(ROOT, 'skill', 'odeuropa-eokg', 'agents', 'openai.yaml'), 'utf8');
  assert.match(yaml, /^interface:\n {2}display_name: "Odeuropa EOKG"$/m);
});

// ChatGPT's skill page keeps line breaks inside a paragraph; Claude joins them.
test('every paragraph and list item of the skill\'s Markdown is one line', () => {
  for (const { name, content } of files.filter((f) => f.name.endsWith('.md'))) {
    const body = name === ENTRY_NAME ? content.slice(content.indexOf('\n---\n', 4) + 5) : content;
    const lines = body.split('\n');
    lines.forEach((line, i) => {
      if (i === 0 || !line.trim() || !lines[i - 1].trim()) return;
      if (/^(#|\||[-*] |\d+\. )/.test(line)) return;
      assert.fail(`${name} wraps a line, run unwrapped: ${line.slice(0, 60)}`);
    });
  }
});
