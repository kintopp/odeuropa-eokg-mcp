# odeuropa-eokg-mcp

[![MCP Protocol](https://img.shields.io/badge/MCP_Protocol-2026--07--28-blue?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIzIi8+PC9zdmc+)](https://modelcontextprotocol.io/specification/2026-07-28) [![MCP SDK](https://img.shields.io/badge/MCP_SDK-v2.4.0-blue?logo=npm&logoColor=white)](https://www.npmjs.com/package/@modelcontextprotocol/server) [![MCP Apps](https://img.shields.io/badge/MCP_Apps-v2.0.4-teal)](https://github.com/modelcontextprotocol/ext-apps) 

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the *European Olfactory Knowledge Graph* (EOKG): about 2.4 million smell references machine-extracted from European texts (English, French, Italian, Slovenian, German, Dutch) and from roughly 44,000 images of artworks, mostly 1600–1920. The [EOKG](https://doi.org/10.5281/zenodo.10709702) and the [Smell Explorer](https://explorer.odeuropa.eu) are the work of the [Odeuropa](https://odeuropa.eu) project (EU Horizon 2020, grant 101004469).

The MCP server allows a researcher to search passages in natural language, resolve vocabulary concepts, profile a smell source over time, and show artworks with their detected smell-related objects. Because the graph models a smell as an event, it can [answer questions](docs/knowledge-graph-queries.md) that a full-text search can address only partially or not at all.

This MCP server was developed by the [Research and Infrastructure Support](https://rise.unibas.ch/en/) (RISE) group at the University of Basel. We are particularly interested in exploring the research opportunities, methodological risks, and technical challenges posed by retrieving and analysing data with LLMs. If you are interested in collaborating with us in this area, please [get in touch](mailto:rise@unibas.ch).

## Install

### Hosted

The best way to get started is with [Claude Desktop](https://claude.com/download) or [claude.ai](https://claude.ai). Add the server to Claude as a remotely hosted [custom connector](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) with this URL:

```
https://odeuropa-eokg-mcp-production.up.railway.app/mcp
```

1. Go to _Customize_ → _Connectors_ → _Add custom connector_.
2. Name the connector as you like and paste the URL into the _Remote MCP Server URL_ field. You can ignore the Authentication section.
3. Optionally, set the permissions for its tools (for example, "Always allow").

Anthropic's [instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) give more detail. The image viewer (`eokg_view_image`) is an [MCP App](https://github.com/modelcontextprotocol/ext-apps) and opens inline in both.

Many other clients also support remotely hosted MCP servers, such as ChatGPT, Mistral's Le Chat and open-source applications; please consult their documentation. In clients without MCP Apps support, the viewer is replaced by plain links. Clients that drop image results from MCP tools, among them the Anthropic API's MCP connector, can't see the pictures `eokg_inspect_image` returns; the assistant then has only titles and box labels.

### Local (stdio)

Requirements: Node.js ≥ 24.22.1 < 25 (no native dependencies).

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

### Skill

The skill file [skill/odeuropa-eokg.skill](skill/odeuropa-eokg.skill) gives the AI assistant guidance in natural language on how to use this server well: which tool to choose for a given question, how to combine them, and the traps in this data. [Skills](https://support.claude.com/en/articles/12512176-what-are-skills) were developed by Anthropic and are now an [open standard](https://agentskills.io/home) and widely supported. To install it in Claude, follow [these instructions](https://claude.com/resources/tutorials/teach-claude-your-way-of-working-using-skills) else consult the documentation of your own LLM client (e.g. ChatGPT).

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
| [`eokg_smell_profile`](docs/tools.md#eokg_smell_profile) | Counts for one concept (smell source, space or gesture) by period, language, dataset, qualities, emotions and spaces, optionally within a year range, plus co-occurring smell sources. |
| [`eokg_find_visual_smells`](docs/tools.md#eokg_find_visual_smells) | Paintings and prints in which a smell source or gesture was detected or catalogued. |
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
- Emotions come from a classifier, and some datasets, German and Slovenian have none.
- Dates are document dates (the emission date almost always equals it) and include noise.
- Words without an operator are OR-ed, and accents must match.
- German and Slovenian are barely linked to concepts, so concept profiles undercount them.
- Filtered searches examine only a window of the most relevant hits.
- Image boxes, including hand-drawn ones, can carry the wrong label.
- Only the olfactory-objects, fragrant-spaces and olfactory-gestures vocabularies can be profiled or counted.
- Iconclass notations ending in `(...)` are placeholders.

Details and examples are in [docs/tools.md](docs/tools.md#data-caveats).

## Limitations

The public endpoint has no SLA and a hard 60-second gateway timeout. Anchored lookups take well under a second, but `eokg_smell_profile` with `include_narrower` can take 15–30 seconds per facet. Please use heavy profile calls considerately, and do not loop them.

## Development

```bash
npm start                # serve over stdio manually (waits for an MCP client; Ctrl-C to stop)
npm run serve            # serve over stateless Streamable HTTP
npm run lint             # ESLint (flat config, Node 24)
npm test                 # offline suite
npm run test:live        # also run the live tests (= EOKG_LIVE=1 npm test)
npm run build:docs       # regenerate docs/tools.md's generated blocks from the server
npm run build:skill      # repack skill/odeuropa-eokg/ into the committed .skill zip
npm run build:viewer     # rebuild the committed viewer page after editing apps/image-viewer/
npm run dev:viewer       # preview the image viewer in a browser
npm run build:iconclass  # rebuild the Iconclass table
npm run inspector        # open the MCP Inspector against the server
```

`npm test` fails if `docs/tools.md`, the `.skill` bundle or the viewer page is stale. Rerun the matching build command and commit the result.

## Citation

If you use odeuropa-eokg-mcp in your research, please cite it as follows:

**APA (7th ed.)**

> Bosse, A. (2026). *odeuropa-eokg-mcp* (Version 0.7.0) [Software]. Research and Infrastructure Support (RISE), University of Basel. https://github.com/kintopp/odeuropa-eokg-mcp

**BibTeX**
```bibtex
@software{bosse_2026_odeuropa_eokg_mcp,
  author    = {Bosse, Arno},
  title     = {{odeuropa-eokg-mcp}},
  year      = {2026},
  version   = {0.7.0},
  publisher = {Research and Infrastructure Support (RISE), University of Basel},
  url       = {https://github.com/kintopp/odeuropa-eokg-mcp},
  orcid     = {0000-0003-3681-1289},
  note      = {Developed with Claude Code (Anthropic, \url{https://www.anthropic.com})}
}
```

Cite the data you report separately, as the European Olfactory Knowledge Graph (see below).

## License

[MIT](./LICENSE) © 2026 University of Basel. The licence covers the code, not the EOKG data it queries.

The European Olfactory Knowledge Graph has its own licence: its dump is published on Zenodo under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) by Pasquale Lisena, Thibault Ehrhart and Raphaël Troncy (EURECOM) for the Odeuropa project, https://doi.org/10.5281/zenodo.10709702. Individual sources carry their own licence in the graph.
