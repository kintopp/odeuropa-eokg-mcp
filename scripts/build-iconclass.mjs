// Builds src/data/iconclass.json from Odeuropa's source CSVs (the KG's own skos:closeMatch
// values are corrupt). To refresh: bump COMMIT, run `npm run build:iconclass`, review the diff.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../src/lib/csv.js';

const COMMIT = 'aa586b1e74864c8befbf614c21bf0ffa6e8b4608';
const SCHEMES = ['olfactory-objects', 'fragrant-spaces'];
const CODE_RE = /^[0-9][0-9A-Z()+.\-]*$/;
const OUT = fileURLToPath(new URL('../src/data/iconclass.json', import.meta.url));

async function build(scheme) {
  const url = `https://raw.githubusercontent.com/Odeuropa/vocabularies/${COMMIT}/raw/${scheme}/en.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  const [header, ...rows] = parseCsv(await res.text());
  const col = (name) => {
    const i = header.findIndex((h) => h.trim() === name);
    if (i < 0) throw new Error(`${scheme}: missing column "${name}" (have: ${header.join(' | ')})`);
    return i;
  };
  const idCol = col('ID');
  const codeCol = col('ICONCLASS CODE');
  const entries = [];
  for (const row of rows) {
    const id = row[idCol]?.trim();
    const codes = (row[codeCol] ?? '').split(',').map((s) => s.trim()).filter((s) => CODE_RE.test(s));
    if (id && codes.length) entries.push([id, codes]);
  }
  entries.sort((a, b) => Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0]));
  return Object.fromEntries(entries);
}

const out = {
  source: `https://github.com/Odeuropa/vocabularies/tree/${COMMIT}/raw`,
  commit: COMMIT,
};
for (const scheme of SCHEMES) out[scheme] = await build(scheme);
await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(SCHEMES.map((s) => `${s} ${Object.keys(out[s]).length}`).join(', '));
