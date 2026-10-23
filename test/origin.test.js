// Origin and Host validation for the HTTP endpoint. A wrong allow here is a DNS-rebinding hole.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, parseMcpAllowedOrigins, isAllowedHost } from '../src/lib/origin.js';

const defaults = parseMcpAllowedOrigins(undefined);

const CASES = [
  ['no Origin header', undefined, true],
  ['claude.ai (exact)', 'https://claude.ai', true],
  ['claude.com (exact)', 'https://claude.com', true],
  ['workspace.claude.ai (subdomain glob)', 'https://workspace.claude.ai', true],
  ['chatgpt.com (exact)', 'https://chatgpt.com', true],
  ['codex.openai.com (*.openai.com)', 'https://codex.openai.com', true],
  ['mistral.ai (exact)', 'https://mistral.ai', true],
  ['chat.mistral.ai (*.mistral.ai)', 'https://chat.mistral.ai', true],
  ['localhost any port', 'http://localhost:6274', true],
  ['127.0.0.1 loopback', 'http://127.0.0.1:5173', true],
  ['IPv6 loopback', 'http://[::1]:3000', true],
  ['non-web scheme (app://)', 'app://desktop-client.example', true],
  ['non-web scheme (chrome-extension://)', 'chrome-extension://abcdef123', true],
  ['sandboxed-iframe literal null', 'null', true],
  ['mixed-case host normalizes', 'https://Claude.AI', true],
  ['unknown web host', 'https://evil.example', false],
  ['unibas.ch is no longer a default', 'https://unibas.ch', false],
  ['subdomain of unibas.ch is no longer a default', 'https://dhlab.philhist.unibas.ch', false],
  ['allowlisted name as a prefix', 'https://claude.ai.evil.example', false],
  ['allowlisted subdomain as a prefix', 'https://www.claude.ai.evil.example', false],
  ['allowlisted name as a suffix', 'https://evilclaude.ai', false],
  ['malformed Origin', 'not a url', false],
  ['bare openai.com (only *.openai.com is listed)', 'https://openai.com', false],
];

for (const [label, origin, expected] of CASES) {
  test(`default allowlist: ${label} -> ${expected ? 'allow' : 'deny'}`, () => {
    assert.equal(isAllowedOrigin(origin, defaults), expected);
  });
}

test('unset, empty and blank MCP_ALLOWED_ORIGINS all give the defaults', () => {
  for (const raw of [undefined, '', '  ']) {
    const list = parseMcpAllowedOrigins(raw);
    assert.equal(isAllowedOrigin('https://claude.ai', list), true, JSON.stringify(raw));
    assert.equal(isAllowedOrigin('https://evil.example', list), false, JSON.stringify(raw));
  }
});

test('a custom list replaces the defaults and anchors each entry', () => {
  const custom = parseMcpAllowedOrigins('https://foo.example,*.bar.example');
  assert.equal(isAllowedOrigin('https://foo.example', custom), true);
  assert.equal(isAllowedOrigin('https://api.bar.example', custom), true);
  assert.equal(isAllowedOrigin('https://bar.example', custom), false, 'glob does not match the apex');
  assert.equal(isAllowedOrigin('https://claude.ai', custom), false, 'defaults are replaced');
  assert.equal(isAllowedOrigin('https://fooXexample', custom), false, '"." is literal');
  assert.equal(isAllowedOrigin('https://foo.example.evil', custom), false, 'exact entry anchored at the end');
  assert.equal(isAllowedOrigin('https://evil-foo.example', custom), false, 'exact entry anchored at the start');
  assert.equal(isAllowedOrigin('https://api.bar.example.evil', custom), false, 'glob anchored at the end');
  assert.equal(isAllowedOrigin('http://localhost:3000', custom), true, 'loopback stays allowed');
});

test('MCP_ALLOWED_ORIGINS=https://x.org replaces the defaults', () => {
  const list = parseMcpAllowedOrigins('https://x.org');
  assert.equal(isAllowedOrigin('https://x.org', list), true);
  assert.equal(isAllowedOrigin('https://claude.ai', list), false);
});

test('"*" disables the web-host check but not the malformed-Origin check', () => {
  const wildcard = parseMcpAllowedOrigins('*');
  assert.equal(isAllowedOrigin('https://any-random-host.example', wildcard), true);
  assert.equal(isAllowedOrigin('not a url', wildcard), false);
});

test('Host: an allowed host matches with or without a port, case-insensitively', () => {
  const hosts = ['mcp.example.org', 'localhost'];
  assert.equal(isAllowedHost('mcp.example.org', hosts), true);
  assert.equal(isAllowedHost('mcp.example.org:8080', hosts), true);
  assert.equal(isAllowedHost('MCP.Example.ORG', hosts), true);
  assert.equal(isAllowedHost('localhost:3000', hosts), true);
});

test('Host: unknown, lookalike and missing hosts are denied', () => {
  const hosts = ['mcp.example.org'];
  assert.equal(isAllowedHost('evil.org', hosts), false);
  assert.equal(isAllowedHost('mcp.example.org.evil.org', hosts), false);
  assert.equal(isAllowedHost('xmcp.example.org', hosts), false);
  assert.equal(isAllowedHost(undefined, hosts), false);
});

test('Host: an empty list skips the check', () => {
  assert.equal(isAllowedHost('anything.example', []), true);
  assert.equal(isAllowedHost(undefined, []), true);
});
