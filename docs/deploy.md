# Hosted deployment

`src/http.js` serves the same tools over stateless Streamable HTTP, so web and mobile clients (claude.ai custom connectors) can use the EOKG without a local install. `src/index.js` stays the stdio entry. The server holds no credentials: the EOKG endpoint is public and read-only.

The endpoint is `POST /mcp`. `GET /health` returns `{ status, server, version, commit, node }`. `GET` and `DELETE` on `/mcp` answer 405, because there are no sessions.

## Run locally

```sh
npm run serve                      # listens on 0.0.0.0:3000
PORT=8080 npm run serve
```

Point the inspector at it with `npx @modelcontextprotocol/inspector` and the URL `http://localhost:3000/mcp`.

## Environment

All variables are optional.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listen port (Railway sets it). `0` picks a free port. |
| `MCP_ALLOWED_ORIGINS` | claude.ai, claude.com, chatgpt.com, `*.openai.com`, mistral.ai and their subdomains | Comma-separated exact origins or `*.host` globs. **Replaces** the defaults. `*` disables the check. A mismatch is 403. |
| `MCP_ALLOWED_HOSTS` | unset | Comma-separated hostnames the `Host` header must match (a port is ignored). `RAILWAY_PUBLIC_DOMAIN` and localhost are added. With neither set, the Host check is skipped. |
| `EOKG_HTTP_RESPONSE_TIMEOUT_MS` | `120000` | Wall-clock limit per request to `/mcp`. Sends 504, or ends a stream already started. |
| `EOKG_HTTP_MAX_INFLIGHT` | `16` | Concurrent requests to `/mcp`. More get 503 with `Retry-After: 5`. |
| `EOKG_LOG` | off | `1` writes one JSON line per tool call to stderr. |
| `EOKG_LOG_INPUT` | off | `1` adds the tool arguments to that line. Off by default on HTTP because search text is user content. |

The Origin check allows a missing Origin, `null`, non-http(s) schemes and loopback on any port. Requests larger than 1 MiB are refused with 413; a client still sending a much larger body may see the connection close before it reads that response. Compressed request bodies (any `Content-Encoding` but `identity`) get 415. Railpack installs the Node version in `.nvmrc`.

The other variables in the README configuration table apply too.

## Railway

The service runs `node src/http.js` with `/health` as its health check, a single replica. Service configuration lives in `.railway/railway.ts` and is applied with `railway config plan` then `railway config apply`; applying it does not upload code. Code deploys from GitHub on every push to `main` that touches `src/`, `package.json` or `package-lock.json` (the `watchPatterns` in `.railway/railway.ts`); `railway up` deploys the local tree by hand. `railway.json` and `railway.toml` are not read.

Keep one replica: the SPARQL concurrency limit (4) is per process, and every hosted user shares one egress IP towards the EOKG.

## Add it to claude.ai

Settings, Connectors, Add custom connector. Use the URL `https://<host>/mcp` and no authentication.

## Limits

- claude.ai gives up on a tool call after 240 s. The server's own guard cuts a request at 120 s, above the slowest legitimate call (`eokg_smell_profile` with `include_narrower`, capped at 50 s).
- Results are capped at about 150,000 characters.
- The `eokg_view_image` viewer is an MCP App and needs a host that supports them; ChatGPT is best-effort. Other hosts get plain links.
- The server is stateless: no session survives between requests.

## Etiquette

The EOKG endpoint is a shared public research resource with a 60 s gateway timeout and no SLA. All hosted users reach it from one address. Do not script heavy profile calls in a loop, and do not publish the URL widely without a per-client rate limit in front of it.
