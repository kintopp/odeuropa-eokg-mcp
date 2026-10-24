# odeuropa-eokg-mcp

[![MCP Protocol](https://img.shields.io/badge/MCP_Protocol-2026--07--28-blue?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIzIi8+PC9zdmc+)](https://modelcontextprotocol.io/specification/2026-07-28) [![MCP SDK](https://img.shields.io/badge/MCP_SDK-v2-blue?logo=npm&logoColor=white)](https://www.npmjs.com/package/@modelcontextprotocol/server) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server for the European Olfactory Knowledge Graph (EOKG): about 2.4 million smell references machine-extracted from European texts (English, French, Italian, Slovenian, German, Dutch) and from roughly 109,000 images of artworks, mostly 1600–1920. It lets an AI assistant search passages, resolve vocabulary concepts, profile a smell source over time, and show artworks with their detected smell-related objects.

The data is the work of the [Odeuropa](https://odeuropa.eu) project (EU Horizon 2020, grant 101004469). Browse it in the [Smell Explorer](https://explorer.odeuropa.eu). The knowledge-graph repository, [Odeuropa/knowledge-graph](https://github.com/Odeuropa/knowledge-graph), is licensed Apache-2.0; individual sources carry their own licence in the graph. This server is an independent client of the public endpoint and is not affiliated with Odeuropa.

## Install

### Remote (default)

A hosted instance runs the same tools over Streamable HTTP. No install, no credentials.

- **claude.ai and Claude Desktop:** Settings → Connectors → Add custom connector, with the URL `https://<hosted-url>/mcp` and no authentication.
- **Claude Code:**

  ```bash
  claude mcp add --transport http odeuropa-eokg https://<hosted-url>/mcp
  ```

The image viewer (`eokg_view_image`) is an [MCP App](https://modelcontextprotocol.io/docs/extensions/apps) and appears only in clients that support MCP Apps. Other clients get plain links instead.

### Local (stdio)

Requirements: Node.js ≥ 24 < 25 (no native dependencies).

```bash
git clone https://github.com/kintopp/odeuropa-eokg-mcp.git
cd odeuropa-eokg-mcp
npm install
```

The MCP client starts the server itself once it is registered. Point the client at the entry file, using **absolute paths** for both `command` and the script:

```jsonc
{
  "mcpServers": {
    "odeuropa-eokg": {
      "command": "/absolute/path/to/bin/node",
      "args": ["/absolute/path/to/odeuropa-eokg-mcp/src/index.js"]
    }
  }
}
```

- **Claude Desktop:** the file is `claude_desktop_config.json` in `~/Library/Application Support/Claude/` (macOS) or `%APPDATA%\Claude\` (Windows). On Windows, double every backslash in the paths. Fully quit and restart Claude Desktop after editing it.
- **Claude Code:** `claude mcp add odeuropa-eokg -- node /absolute/path/to/odeuropa-eokg-mcp/src/index.js`
- **ChatGPT desktop app and Codex:** add a `[mcp_servers.odeuropa-eokg]` table with `command = "…"` and `args = […]` to `~/.codex/config.toml`. The format is TOML, not JSON.

To check the install without a client, run `npm test`.

### Skill (optional)

[skill/odeuropa-smells.skill](skill/odeuropa-smells.skill) teaches a model the research patterns and the traps of this data. In Claude Desktop, double-click the file, or go to Settings → Skills → Add; the latter also works in claude.ai.

## Tools

All ten tools are read-only. Each returns a human-readable summary (`content[].text`) and structured data (`structuredContent`). A typical flow:

1. `eokg_search_smells` for passages;
2. `eokg_get_smell` for one reference;
3. `eokg_get_source` for its document or image.

For artworks, use `eokg_find_visual_smells`, then `eokg_view_image` to show one.

| Tool | What it does |
|---|---|
| [`eokg_list_datasets`](docs/tools.md#eokg_list_datasets) | List the 21 source corpora with a dated snapshot of smell counts. |
| [`eokg_search_smells`](docs/tools.md#eokg_search_smells) | Full-text search of smell excerpts and titles, with language, year and dataset filters. |
| [`eokg_get_smell`](docs/tools.md#eokg_get_smell) | One smell reference: source, excerpt and extracted roles. |
| [`eokg_get_source`](docs/tools.md#eokg_get_source) | A source text or image with a page of its smells. |
| [`eokg_find_concepts`](docs/tools.md#eokg_find_concepts) | Find smell-source and fragrant-space concepts by label or Iconclass notation. |
| [`eokg_get_concept`](docs/tools.md#eokg_get_concept) | A concept's labels, hierarchy, linked-smell counts and Iconclass notation. |
| [`eokg_smell_profile`](docs/tools.md#eokg_smell_profile) | Counts for one concept by period, language, dataset, qualities, emotions and spaces. |
| [`eokg_find_visual_smells`](docs/tools.md#eokg_find_visual_smells) | Paintings and prints in which a smell source was detected or catalogued. |
| [`eokg_inspect_image`](docs/tools.md#eokg_inspect_image) | The picture of an image source with its annotated objects, for the model's own analysis. |
| [`eokg_view_image`](docs/tools.md#eokg_view_image) | Shows an image source to the user in an interactive viewer. Object boxes start hidden; a Boxes button shows them. |

Full descriptions and parameters are in [docs/tools.md](docs/tools.md).

## Configuration (env vars)

All variables are optional.

| Variable | Default | Meaning |
|---|---|---|
| `EOKG_SPARQL_ENDPOINT` | `https://data.odeuropa.eu/repositories/odeuropa` | SPARQL endpoint. |
| `EOKG_SKOSMOS_BASE` | `https://vocab.odeuropa.eu/rest/v1/` | Skosmos REST base for vocabulary search. |
| `EOKG_TIMEOUT_MS` | `45000` | Per-request timeout (1,000–600,000). The endpoint's gateway cuts at 60 s. |
| `EOKG_RESULT_CHAR_CEILING` | `150000` | Upper bound on a tool result's size in characters. |
| `EOKG_LOG` | off | `1` writes one JSON line per tool call to stderr. |

To host your own instance, run `npm run serve`, which serves stateless Streamable HTTP from `src/http.js`. Setup, HTTP variables and limits are in [docs/deploy.md](docs/deploy.md).

## Data caveats

- Excerpts are raw OCR text.
- Emotions come from a classifier.
- Dates mix the document date and the emission date, and include noise.
- Filtered searches examine only a window of the most relevant hits.
- Image boxes, including hand-drawn ones, can carry the wrong label.
- Only the olfactory-objects and fragrant-spaces vocabularies are linked to smells.
- Iconclass notations ending in `(...)` are placeholders.

Details and examples are in [docs/tools.md](docs/tools.md#data-caveats).

## Fair use

The public endpoint has no SLA and a hard 60-second gateway timeout. Anchored lookups take well under a second, but `eokg_smell_profile` with `include_narrower` can take 15–30 seconds per facet. Use heavy profile calls considerately, and do not loop them.

## Development

```bash
npm start                # serve over stdio manually (waits for an MCP client; Ctrl-C to stop)
npm run serve            # serve over stateless Streamable HTTP
npm run lint             # ESLint (flat config, Node 24)
npm test                 # offline suite
npm run test:live        # also run the live tests (= EOKG_LIVE=1 npm test)
npm run build:docs       # regenerate docs/tools.md's generated blocks from the server
npm run build:skill      # repack skill/odeuropa-smells/ into the committed .skill zip
npm run build:viewer     # rebuild the committed viewer page after editing apps/image-viewer/
npm run dev:viewer       # preview the image viewer in a browser
npm run build:iconclass  # rebuild the Iconclass table
npm run inspector        # open the MCP Inspector against the server
```

`npm test` fails if `docs/tools.md`, the `.skill` bundle or the viewer page is stale. Rerun the matching build command and commit the result.

## License

[MIT](./LICENSE) © 2026 Arno Bosse. The licence covers the code, not the EOKG data it queries; see the Odeuropa terms above.
