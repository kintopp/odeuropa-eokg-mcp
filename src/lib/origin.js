// Origin and Host validation for the HTTP endpoint (DNS-rebinding mitigation).
//
// Origin rules: a missing Origin, the literal "null", non-http(s) schemes and loopback
// hosts are allowed; any other http(s) Origin must match the allowlist; an Origin that
// does not parse is denied.

const DEFAULT_WEB_HOST_PATTERNS = [
  /^claude\.ai$/i, /^.+\.claude\.ai$/i,
  /^claude\.com$/i, /^.+\.claude\.com$/i,
  /^chatgpt\.com$/i, /^.+\.chatgpt\.com$/i,
  /^.+\.openai\.com$/i,
  /^mistral\.ai$/i, /^.+\.mistral\.ai$/i,
];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function entryToHostPattern(entry) {
  let host = entry;
  try { host = new URL(entry).hostname; } catch { /* a bare hostname or glob */ }
  const wildcard = host.startsWith('*.');
  const escaped = (wildcard ? host.slice(2) : host).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(wildcard ? `^.+\\.${escaped}$` : `^${escaped}$`, 'i');
}

// unset or blank → defaults; "*" → "*"; otherwise a comma-separated list of exact
// origins or `*.host` globs that REPLACES the defaults.
export function parseMcpAllowedOrigins(raw) {
  if (!raw || raw.trim() === '') return [...DEFAULT_WEB_HOST_PATTERNS];
  if (raw.trim() === '*') return '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map(entryToHostPattern);
}

export function isAllowedOrigin(origin, allowlist) {
  if (origin === undefined) return true;
  if (origin === 'null') return true;
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  if (LOOPBACK_HOSTS.has(u.hostname)) return true;
  if (allowlist === '*') return true;
  return allowlist.some((re) => re.test(u.hostname));
}

// An empty list means the Host check is off.
export function isAllowedHost(hostHeader, allowedHosts) {
  if (allowedHosts.length === 0) return true;
  if (!hostHeader) return false;
  let hostname;
  try { hostname = new URL(`http://${hostHeader}`).hostname; } catch { return false; }
  return allowedHosts.some((h) => h.toLowerCase() === hostname);
}
