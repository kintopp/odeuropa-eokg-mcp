// Minimal RFC 4180 CSV parser: quoted fields, "" escapes, embedded commas/newlines, CRLF or LF.

/** Parse CSV text into an array of row arrays. A leading BOM is stripped. */
export function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let pending = false; // a row has started but is not yet pushed
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; pending = true; }
    else if (ch === ',') { row.push(field); field = ''; pending = true; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; pending = false;
    } else { field += ch; pending = true; }
  }
  if (pending) { row.push(field); rows.push(row); }
  return rows;
}
