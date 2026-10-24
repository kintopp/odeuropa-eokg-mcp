# odeuropa-eokg-mcp

An MCP server for the European Olfactory Knowledge Graph (EOKG): about 2.4 million smell references machine-extracted from European texts (English, French, Italian, Slovenian, German, Dutch) and from roughly 109,000 images of artworks, mostly 1600–1920. It lets an AI assistant search passages, resolve vocabulary concepts, profile a smell source over time, and look at artworks with detected smell-related objects.

The data is the work of the [Odeuropa](https://odeuropa.eu) project (EU Horizon 2020, grant 101004469). Browse it in the [Smell Explorer](https://explorer.odeuropa.eu). The knowledge-graph repository, [Odeuropa/knowledge-graph](https://github.com/Odeuropa/knowledge-graph), is licensed Apache-2.0; individual sources carry their own licence in the graph. This server is an independent client of the public endpoint and is not affiliated with Odeuropa.

## Tools

| Tool | Purpose |
|---|---|
| `eokg_list_datasets` | List the 21 source corpora with a dated snapshot of smell counts. |
| `eokg_search_smells` | Full-text search of smell excerpts and titles, with language, year and dataset filters. |
| `eokg_get_smell` | One smell reference: source, excerpt and extracted roles. |
| `eokg_get_source` | A source text or image with a page of its smells. |
| `eokg_find_concepts` | Find smell-source and fragrant-space concepts by label or Iconclass notation. |
| `eokg_get_concept` | A concept's labels, hierarchy, linked-smell counts and Iconclass notation. |
| `eokg_smell_profile` | Counts for one concept by period, language, dataset, qualities, emotions and spaces. |
| `eokg_find_visual_smells` | Paintings and prints in which a smell source was detected or catalogued. |
| `eokg_inspect_image` | The picture of an image source with its annotated objects. |
| `eokg_view_image` | Shows an image source to the user in an interactive viewer (MCP Apps). |

Full descriptions and parameters: [docs/tools.md](docs/tools.md). An optional skill, [skill/odeuropa-smells.skill](skill/odeuropa-smells.skill), teaches a model the research patterns and the traps.

## Install

Requires Node 24. The server speaks MCP over stdio (`node src/index.js`).

From a local checkout:

```sh
git clone https://github.com/kintopp/odeuropa-eokg-mcp.git && cd odeuropa-eokg-mcp && npm install
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "odeuropa-eokg": {
      "command": "node",
      "args": ["/absolute/path/to/odeuropa-eokg-mcp/src/index.js"]
    }
  }
}
```

Claude Code:

```sh
claude mcp add odeuropa-eokg -- node /absolute/path/to/odeuropa-eokg-mcp/src/index.js
```

Running straight from git with `npx` also works for anyone with access to the repository: replace the command with `npx` and the args with `["-y", "github:kintopp/odeuropa-eokg-mcp"]`.

## Configuration

All variables are optional.

| Variable | Default | Meaning |
|---|---|---|
| `EOKG_SPARQL_ENDPOINT` | `https://data.odeuropa.eu/repositories/odeuropa` | SPARQL endpoint. |
| `EOKG_SKOSMOS_BASE` | `https://vocab.odeuropa.eu/rest/v1/` | Skosmos REST base for vocabulary search. |
| `EOKG_TIMEOUT_MS` | `45000` | Per-request timeout (1,000–600,000). The endpoint's gateway cuts at 60 s. |
| `EOKG_RESULT_CHAR_CEILING` | `150000` | Upper bound on a tool result's size in characters. |
| `EOKG_LOG` | off | `1` writes one JSON line per tool call to stderr. |

## Hosted connector

`npm run serve` runs the same tools over stateless Streamable HTTP (`src/http.js`), which lets claude.ai add the server as a custom connector. Setup, environment variables and limits: [docs/deploy.md](docs/deploy.md).

## Data caveats

Excerpts are raw OCR text; emotions come from a classifier; dates mix the document date and the emission date and include noise; filtered searches examine only a window of the most relevant hits; only the olfactory-objects and fragrant-spaces vocabularies are linked to smells; Iconclass notations ending in `(...)` are placeholders. Details and examples are in [docs/tools.md](docs/tools.md#data-caveats).

## Development

| Purpose | Command |
|---|---|
| Offline tests | `npm test` |
| Live tests (network) | `npm run test:live` |
| Lint | `npm run lint` |
| Regenerate `docs/tools.md` from the running server | `npm run build:docs` |
| Rebuild `skill/odeuropa-smells.skill` | `npm run build:skill` |
| Rebuild the Iconclass table | `npm run build:iconclass` |
| Rebuild the image viewer page after editing `apps/image-viewer/` | `npm run build:viewer` |
| Preview the image viewer in a browser | `npm run dev:viewer` |
| Inspector | `npm run inspector` |

`npm test` fails if `docs/tools.md` or the `.skill` bundle is stale; rerun the matching build command and commit the result.

## Fair use

The public endpoint has no SLA and a hard 60-second gateway timeout. Anchored lookups take well under a second, but `eokg_smell_profile` with `include_narrower` can take 15–30 seconds per facet. Use heavy profile calls considerately, and do not loop them.
