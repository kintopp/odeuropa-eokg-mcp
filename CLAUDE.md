# odeuropa-eokg-mcp

## What this is

An MCP server over the European Olfactory Knowledge Graph (EOKG, Odeuropa): a public GraphDB SPARQL endpoint with ~2.4M smell references from European texts and images (1600–1920). Node 24, pure ESM, no build step; runtime deps are `@modelcontextprotocol/server` and `zod`.

## Commands

| Purpose | Command |
|---|---|
| Install | `npm install` |
| Tests (offline) | `npm test` |
| Live tests (network) | `EOKG_LIVE=1 npm test` |
| Lint | `npm run lint` |
| Regenerate `docs/tools.md` | `npm run build:docs` |
| Rebuild the skill bundle | `npm run build:skill` |
| Inspector (manual) | `npm run inspector` |

## Conventions to follow

- **Two output channels.** Every tool returns `content[{type:'text',text}]` and `structuredContent`, both produced from one structured object.
- **Errors are tool results.** Every failure inside a handler reaches the client as `isError: true`, never as a JSON-RPC error. The error result has no `structuredContent`, because an error object fails outputSchema validation with -32602.
- **Input schemas are `.strict()` and `$ref`-free.** Output schemas are `$ref`-free too. A zod schema instance reused in two places can serialize to `$ref`, so build each field fresh; don't share one `z.string()` constant across fields.
- **The first sentence of a tool description is ≤ 79 characters** (text up to the first `". "`, in code points). Hosts truncate there.
- **stdout is JSON-RPC only.** All logging goes through `console.error`.
- **Never set a human-readable `serverInfo.title`.** Claude Desktop derives tool ids from it and drops the tools from tool search. Use only the machine name.
- **Backend constants live in `src/config.js`.** Don't scatter magic strings.
- Register tools as in `src/tools/list_datasets.js`: `server.registerTool(name, { title, description, inputSchema, outputSchema, annotations: READ_ONLY_ANNOTATIONS }, withTool(name, label, async (args, ctx) => …))`, passing `ctx?.mcpReq?.signal` to the backend.
- Every tool lives in `src/tools/<name>.js`, is registered in `src/server.js` and is listed in `REQUIRED_PROPS` in `test/smoke.test.js`.
- Every SPARQL query is sent through `sparqlSelect(name, body)` with a unique `eokg:<name>` label; the offline stub router depends on it.
- Committed files never reference `plans/` or `research/` by path (both are gitignored).
- **A push to `main` that touches `src/`, `package.json` or `package-lock.json` redeploys the public Railway service.** Push only when the user asks.
- Test rules are in `test/CLAUDE.md`. Never delete or weaken a failing test.

## Architecture

- `src/index.js`, `src/server.js`: stdio entry point and tool registration.
- `src/http.js`, `src/lib/webbridge.js`, `src/lib/origin.js`: stateless Streamable HTTP entry (`npm run serve`) over `node:http`. Guards, in order: Host, Origin, in-flight cap, 1 MiB body, 120 s wall-clock response guard (details in `docs/deploy.md`). Never add a flag or `PORT` sniff to `src/index.js`.
- `src/config.js`: every backend constant, the dataset snapshot and `SERVER_INSTRUCTIONS`.
- `src/tools/`: one file per tool (schemas, description, handler, shaping).
- `src/sparql/`: SPARQL client, Lucene query building, prefixes and `queries/`.
- `src/skosmos/`: Skosmos REST client for vocabulary search.
- `src/image/`: image fetching and size limits (`data.odeuropa.eu/image/` only).
- `src/lib/`: shared helpers (tool wrapper, errors, budgets, caching, CSV, ids, warnings).
- `apps/image-viewer/`: MCP App source; `npm run build:viewer` writes the committed `src/apps/image-viewer.html`.
- `src/data/iconclass.json`: curated Iconclass sidecar, built by `npm run build:iconclass`.
- `scripts/`: build and measurement scripts. `docs/tools.md` and `skill/odeuropa-eokg.skill` are generated or checked artefacts.

## Adding a tool touches these places

1. `src/tools/<name>.js`
2. `src/server.js` (register it)
3. `REQUIRED_PROPS` in `test/smoke.test.js`
4. `docs/tools.md`: add a `## \`eokg_<name>\`` section with the three generated markers, then run `npm run build:docs`
5. `skill/odeuropa-eokg/SKILL.md` if it changes a workflow (then `npm run build:skill`)
6. The tools table in `README.md`

## Backend facts that drive the whole design

`backend-facts.md` *(internal)* is the full record; the essentials:

- **Hard 60 s nginx gateway timeout** (HTTP 504, HTML body). A retry of a timed-out query costs another 60 s and fails the same way.
- Anchored lookups (smell id, concept URI, Lucene hit set) take 40–400 ms; concept-anchored aggregates 0.8–3.5 s; unanchored whole-graph aggregates 20–40 s or time out. **No tool may issue an unanchored aggregate.**
- Lucene full-text: one connector, `luc-index:search`, fields `source_value` (excerpt text) and `source_label` (source title) on `od:L11_Smell`; no language, date or dataset fields. The query must name a field.
- A Lucene syntax error is HTTP 500 with `Cannot parse Lucene query …` (a correctable user error); an unknown field name silently gives 0 rows.
- Language/year/dataset filters must be SPARQL patterns after the Lucene call, so `luc:totalHits` counts unfiltered hits.
- `schema:` is `https://schema.org/`; the http form matches nothing.
- `od:F3_had_source` returns three kinds of value:

  | value | meaning | keep as |
  |---|---|---|
  | olfactory-objects concept URI | the vocabulary concept | `smell_source.concept` |
  | `…/object/<uuid>` | the words used in this text | `smell_source.mention` |
  | Wikidata entity | inferred `owl:sameAs` twin, not in the data | drop |

## Common Errors

- **Never retry a SPARQL 504:** the gateway's 60 s cut is deterministic for a given query; retrying costs another minute and fails the same way.
- **luc:snippets over a window:** snippets are computed for every hit in luc:limit; only request them when the window is the page (24 s at 5k hits).
- **Skosmos 200 + HTML:** an unknown vocab id returns a PHP fatal-error page with status 200; the VOCABS enum prevents it.
- **railway.json is not read:** Railway's Config as Code is deprecated (new services cannot use it; existing ones stop on 2026-12-01). Service config lives in .railway/railway.ts and is applied with railway config apply; code is deployed separately.
- **`svg.hidden = true` does nothing:** `hidden` is an HTML element property; on an SVGElement it is a plain JS expando. Hide SVG with a class and `display: none`.
- **closeMatch is corrupt:** never read skos:closeMatch for Iconclass; use src/data/iconclass.json.
- **`SAMPLE(?label)` picks up sameAs twin labels:** inference copies GeoNames and Wikidata labels onto vocabulary concepts; bind labels inside the vocabulary's named graph.
- **Skosmos `lang` restricts matching:** it is not a display preference; pass it only to filter.
- **Lucene: a lone `NOT` matches nothing and `/` opens a regex:** both are handled in `scopedLuceneQuery`; keep its tests.
- **Malformed related URIs in fragrant-spaces:** `http://data.odeuropa.eu/olfactory_objects/<n>` means `vocabulary/olfactory-objects/<n>`; `get_concept` maps it.
- **Skill `name:` must equal its folder name:** renaming the skill means renaming `skill/<name>/`, `SKILL_NAME` in `scripts/build-skill.mjs` and the bundle, then re-uploading it to claude.ai.
- **Gestures link through experiences:** `od:F5_involved_gesture` (experience) and `oa:hasBody` / `crm:P138_represents` (images), not `crm:P137_exemplifies`.
