# Tool Descriptions and Parameters

Each tool below is documented three ways: a prose summary for human readers, the **tool description** the server actually sends over MCP, and its parameters.

The tool descriptions (from `src/tools/*.js`) are the only per-tool guidance a model gets when deciding which tool to call. They are complemented by the **server instructions** below (from `src/config.js`), sent once when a client initialises the connection, and by the optional [SKILL.md](../skill/odeuropa-smells/SKILL.md), which teaches research patterns. Everything in a generated block is rendered from the running server by `npm run build:docs`; the prose around it is hand-written.

## Server instructions

<!-- generated:instructions -->
> Search the European Olfactory Knowledge Graph (Odeuropa): ~2.4M smell references machine-extracted from European texts (en, fr, it, sl, de, nl) and from ~109,000 images of artworks, mostly 1600–1920. A "smell" is one extracted reference: a passage or image plus its roles — smell source (a vocabulary concept and the words used), carrier, time, place, perceiver, emotions, qualities. Workflow: `eokg_search_smells` for passages (Lucene syntax, no field prefixes) → `eokg_get_smell` for one reference → `eokg_get_source` for the document or image around it. Search words without an operator are OR-ed; write AND/OR/NOT in capitals and quote phrases. For concept-level questions, resolve the concept first with `eokg_find_concepts` (olfactory-objects = what smells, fragrant-spaces = where, olfactory-gestures = how people smelled), then `eokg_smell_profile` for counts over time, languages, datasets, qualities, emotions and spaces, and `eokg_find_visual_smells` + `eokg_inspect_image` for artworks. Read results critically: excerpts are raw OCR text; one passage can yield several smells, each its own result; emotions come from a classifier, not the text, and are a weak signal; dates are document dates (the emission date almost always equals it) and include noise and undated sources; profile counts compare concepts with each other and are not absolute trends; filtered searches examine only a window of the most relevant hits and say so; image boxes, including hand-drawn ones, can carry the wrong label. Profiles and image lists work for olfactory-objects, fragrant-spaces and olfactory-gestures concepts (gestures such as holding one's nose, almost all from images); the other vocabularies describe smells but cannot be counted with these tools. Iconclass notations come from Odeuropa's curated tables; a notation ending in (...) is a placeholder to be completed and verified with an Iconclass server. To show an artwork to the user, call `eokg_view_image`, which opens a viewer; never embed an image URL as a Markdown image. If no viewer appears, give image and record URLs as plain links. Its object boxes start hidden, since many carry the wrong label; the user can turn them on with the viewer's Boxes button. Cite smells with their explorer_url (https://explorer.odeuropa.eu/smells/…).
<!-- /generated -->

## `eokg_list_datasets`

Lists the 21 source corpora (named graphs) with their smell counts. The counts are a dated snapshot compiled offline, because counting live takes about 20 seconds and the endpoint cuts requests at 60. Use it to learn which `dataset` values `eokg_search_smells` accepts.

### Tool description

<!-- generated:eokg_list_datasets:description -->
> List the source corpora (datasets) in the knowledge graph, with smell counts. Counts are a dated snapshot; each dataset name is a valid `dataset` filter for eokg_search_smells.
<!-- /generated -->

### Parameters

<!-- generated:eokg_list_datasets:parameters -->
| Param | Type | Default | Description |
|---|---|---|---|
<!-- /generated -->

## `eokg_search_smells`

Full-text search over smell excerpts and source titles using Lucene syntax. Results are ranked by relevance; language, year and dataset filters are applied afterwards to a window of the most relevant hits, and the result states how many hits were scanned. Matching is on raw OCR text, so period spellings and each language's own word matter.

### Tool description

<!-- generated:eokg_search_smells:description -->
> Full-text search of smell excerpts and source titles, ranked by relevance. Matching is on the extracted excerpt text (OCR, unnormalised spelling). Language, year and dataset filters are applied after ranking, to a window of the most relevant hits, so a filtered search reports how many hits it scanned and may miss rarer matches; the result says when. Year filters use the document date; undated sources are kept. One passage can contain several smells; each is its own result with its own id and concept, so the same excerpt can appear more than once. Follow up with eokg_get_smell for a full record.
<!-- /generated -->

### Parameters

<!-- generated:eokg_search_smells:parameters -->
| Param | Type | Default | Description |
|---|---|---|---|
| `text` | string (≤ 500) | **required** | Lucene query text without field prefixes. Words without an operator are OR-ed: write AND/OR/NOT in capitals, and quote phrases and hyphenated words ("eau de cologne"). Trailing * and ? wildcards and ~ fuzzy matching work. Accents and umlauts must match exactly (égouts ≠ egouts); search both forms when unsure. Search in the language of the texts you want. |
| `in` | enum: `excerpt` · `title` · `both` | `excerpt` | Search the smell excerpts (default), the source titles, or both. |
| `language` | enum: `en` · `fr` · `it` · `sl` · `de` · `nl` | — | Only smells from sources in this language. |
| `year_from` | int (1000–2100) | — | Earliest document date, inclusive. A date range such as 1616/1678 counts by its first year. Undated sources are kept. |
| `year_to` | int (1000–2100) | — | Latest document date, inclusive. A date range such as 1616/1678 counts by its first year. Undated sources are kept. |
| `dataset` | enum: `medical-heritage` · `gallica` · `british-library` · `wikisource` · `eebo` · `dbnl` · `gutenberg` · `liberliber` · `odor` · `dlib` · `europeana` · `dta` · `ecco` · `text-annotation` · `pulse` · `royal-society-corpus` · `nuk` · `old-bailey-corpus` · `bibbleue` · `grimm` · `rijksmuseum` | — | Only smells from this source corpus (see eokg_list_datasets). |
| `limit` | int (1–50) | `10` | Results per page. |
| `offset` | int (0–10000) | `0` | Results to skip. |
<!-- /generated -->

## `eokg_get_smell`

Returns one smell reference in full: source document or image, excerpt, and the extracted roles (smell source, carrier, time, place, perceiver, emotions, qualities). Emotions are classifier output, not statements in the text. The result carries the `explorer_url` to cite.

### Tool description

<!-- generated:eokg_get_smell:description -->
> Get one smell reference: its source text or image, excerpt and extracted roles. Roles are machine-extracted: smell source (vocabulary concept plus the words used), carrier, time, place, perceiver, emotions, qualities. Emotions are inferred by a classifier, not stated in the text. Ids come from eokg_search_smells, eokg_get_source or eokg_find_visual_smells.
<!-- /generated -->

### Parameters

<!-- generated:eokg_get_smell:parameters -->
| Param | Type | Default | Description |
|---|---|---|---|
| `id` | string (≤ 300) | **required** | Smell id: the http://data.odeuropa.eu/smell/<uuid> URI, the bare uuid, or an Explorer /smells/<uuid> link. |
<!-- /generated -->

## `eokg_get_source`

Returns a text or image source with its metadata and a page of the smells it contains, each with its concepts and a short excerpt. Smells have no meaningful order within a document. For images it also lists the detected objects with bounding boxes.

### Tool description

<!-- generated:eokg_get_source:description -->
> Get a source text or image: its metadata and a page of the smells it contains. Smells are listed in no meaningful order (the graph keeps no position within the document), each with its vocabulary concepts and a short excerpt. For an image source, also lists the objects the detector found, with bounding boxes; call eokg_inspect_image to see the picture.
<!-- /generated -->

### Parameters

<!-- generated:eokg_get_source:parameters -->
| Param | Type | Default | Description |
|---|---|---|---|
| `id` | string (≤ 300) | **required** | Source id: the http://data.odeuropa.eu/source/<uuid> URI or the bare uuid, as returned by eokg_get_smell (source.id). |
| `limit` | int (1–100) | `20` | Smells per page (1-100, default 20). |
| `offset` | int (0–100000) | `0` | Smells to skip, for paging. |
<!-- /generated -->

## `eokg_find_concepts`

Looks up vocabulary concepts by label in six languages, or by Iconclass notation. By default only olfactory-objects (what smells) and fragrant-spaces (where) are searched, because only those are linked to smells. The returned ids feed `eokg_get_concept`, `eokg_smell_profile` and `eokg_find_visual_smells`.

### Tool description

<!-- generated:eokg_find_concepts:description -->
> Find smell-source, space and gesture concepts by label, in any language. Matches labels in de, en, fr, it, nl or sl; a trailing * is added unless the query already has one. By default searches the three vocabularies linked to smells: olfactory-objects (what smells), fragrant-spaces (where) and olfactory-gestures (how people smelled). Pass a concept id to eokg_get_concept or eokg_smell_profile; vocab "all" also searches the descriptive vocabularies, which are not linked to smells. Alternatively pass iconclass (a notation such as 25G41(ROSE), e.g. from an Iconclass or Rijksmuseum server) instead of query, to find the concepts Odeuropa mapped to that notation or to broader or narrower ones.
<!-- /generated -->

### Parameters

<!-- generated:eokg_find_concepts:parameters -->
| Param | Type | Default | Description |
|---|---|---|---|
| `query` | string (≤ 100) | — | Label to search for, in any of de, en, fr, it, nl, sl (e.g. "rose", "jardin"). A trailing * is added unless present. |
| `iconclass` | string (≤ 100) | — | Iconclass notation (e.g. 25G41(ROSE)) instead of query: finds concepts mapped to it or to broader or narrower notations. |
| `vocab` | enum: `olfactory-objects` · `fragrant-spaces` · `dhsv-sw` · `dravnieks` · `dravnieks-odorants` · `drom` · `edward_wheel` · `expert-taxonomy` · `expert-taxonomy-chemical` · `expert-taxonomy-quality` · `flavornet-odorants` · `flavornet-odors` · `historic-book` · `historical-scent` · `noses` · `olfactory-gestures` · `plutchik` · `vdi-hedonic` · `vdi-intensity` · `zwaardemaker` or string[] or `all` | — | Vocabulary or vocabularies to search. Default: olfactory-objects, fragrant-spaces and olfactory-gestures, the three linked to smells. "all" searches every vocabulary. |
| `lang` | enum: `en` · `fr` · `it` · `sl` · `de` · `nl` | — | Show labels in this language where the concept has one. Matching always covers all six languages. |
| `limit` | int (1–50) | `10` | Maximum results (default 10). |
<!-- /generated -->

## `eokg_get_concept`

Returns one concept: its labels, hierarchy, how many smells and image sources are linked to it, and the curated Iconclass notation where Odeuropa assigned one. A notation ending in `(...)` is a placeholder that needs an Iconclass server to complete and verify.

### Tool description

<!-- generated:eokg_get_concept:description -->
> Get a vocabulary concept: labels in six languages, hierarchy, and usage counts. For olfactory-objects, fragrant-spaces and olfactory-gestures concepts, also returns how many smells (and, for objects and gestures, image sources) the knowledge graph links to it, and the curated Iconclass notation where Odeuropa assigned one. A notation ending in (...) is an Iconclass placeholder for a name; the candidate with the name filled in is unverified, so check it with an Iconclass server before using it.
<!-- /generated -->

### Parameters

<!-- generated:eokg_get_concept:parameters -->
| Param | Type | Default | Description |
|---|---|---|---|
| `id` | string (≤ 300) | **required** | Concept id as eokg_find_concepts returns it: the http://data.odeuropa.eu/vocabulary/<scheme>/<id> URI or <scheme>/<id> (e.g. olfactory-objects/138). |
<!-- /generated -->

## `eokg_smell_profile`

Counts the smells linked to one concept by period, language, dataset, qualities, emotions and fragrant spaces, with emission dates, raw places and carriers on request. Queries are anchored on the concept, so a default profile takes seconds; `include_narrower` covers sub-concepts but takes 15 to 30 seconds per facet. Facets that miss the time budget are reported, not silently dropped.

### Tool description

<!-- generated:eokg_smell_profile:description -->
> Profile a smell source, fragrant space or gesture across the whole graph. Counts smells linked to an olfactory-objects, fragrant-spaces or olfactory-gestures concept (from eokg_find_concepts) by 20-year period of document date (bucket_years changes it), language, dataset, qualities, emotions and fragrant spaces; emission dates, raw place labels and carriers on request. The languages facet counts text smells only; image smells are in the total and the timeline but have no language. The emission date is extracted from the text but in almost every record equals the document date, so emission_timeline rarely differs from timeline. All values are machine-extracted: dates include OCR noise (reported as out_of_range), and emotions are inferred by a classifier. Gesture smells come almost entirely from images, so a gesture profile leaves out languages by default. year_from and year_to restrict the profile to a period by document date; undated sources drop out, and images can be a large share of a period's smells. include_narrower adds sub-concepts (e.g. all flowers) but takes 15–30 s per facet; facets that do not fit the time budget are listed in failed_facets.
<!-- /generated -->

### Parameters

<!-- generated:eokg_smell_profile:parameters -->
| Param | Type | Default | Description |
|---|---|---|---|
| `concept` | string (≤ 300) | **required** | An olfactory-objects, fragrant-spaces or olfactory-gestures concept id as eokg_find_concepts returns it (e.g. olfactory-objects/138 for Rose, olfactory-gestures/2 for holding one's nose). |
| `facets` | string[] | — | Which aggregates to compute. Default: timeline, languages, datasets, qualities, emotions, fragrant_spaces (with include_narrower: timeline, languages, datasets). Opt-in: emission_timeline, places, carriers. |
| `include_narrower` | bool | `false` | Also count smells of narrower concepts (e.g. Flower for every flower). Slow: allows at most 3 facets. |
| `bucket_years` | enum: `10` · `20` · `50` | `20` | Timeline bucket width: 10, 20 or 50 years. |
| `top` | int (1–25) | `10` | Values per ranked facet. |
| `language` | enum: `en` · `fr` · `it` · `sl` · `de` · `nl` | — | Only count smells from sources in this language. Not combinable with include_narrower. |
| `year_from` | int (1000–2100) | — | Only smells whose source is dated in this range (document date, inclusive; a range such as 1616/1678 counts by its first year). Undated sources are excluded. |
| `year_to` | int (1000–2100) | — | Only smells whose source is dated in this range (document date, inclusive; a range such as 1616/1678 counts by its first year). Undated sources are excluded. |
<!-- /generated -->

## `eokg_find_visual_smells`

Lists paintings and prints linked to an olfactory-objects concept, images with hand-drawn boxes first, then by the detector's best confidence for it, then catalogue-only links. Year filters use the artwork date and exclude undated works. Images whose boxes all score below `min_score` (default 0.7) are hidden and counted.

### Tool description

<!-- generated:eokg_find_visual_smells:description -->
> Find paintings and prints in which a smell source or gesture appears. Lists image sources linked to an olfactory-objects or olfactory-gestures concept, best box score first: images with hand-drawn boxes (score 1) come first, then images ranked by the object detector's confidence, then catalogue-only links with no box. Images whose boxes all score below min_score (default 0.7) are hidden and counted; boxes and best_score count only the boxes shown. Images are linked to the objects they show, so substances often have none; try a related object concept. Year filters use the artwork date and exclude undated works. Pass a result id to eokg_inspect_image to look at it.
<!-- /generated -->

### Parameters

<!-- generated:eokg_find_visual_smells:parameters -->
| Param | Type | Default | Description |
|---|---|---|---|
| `concept` | string (≤ 300) | **required** | An olfactory-objects or olfactory-gestures concept id as eokg_find_concepts returns it (e.g. olfactory-objects/138 for Rose, olfactory-gestures/2 for holding one's nose). Exact concept only, no narrower concepts. |
| `year_from` | int (1000–2100) | — | Earliest artwork date (inclusive). Undated works are excluded. |
| `year_to` | int (1000–2100) | — | Latest artwork date (inclusive). Undated works are excluded. |
| `limit` | int (1–50) | `10` | Same as `eokg_search_smells`. |
| `offset` | int (0–5000) | `0` | Results to skip. |
| `min_score` | number (0–1) | `0.7` | Hide images whose boxes for this concept all score below this (0-1, default 0.7); boxes and best_score count only boxes at or above it. Hand-drawn boxes score 1. Pass 0 for every image. |
<!-- /generated -->

## `eokg_inspect_image`

Fetches the picture of an image source together with its annotated objects: concept, bounding box in percent, and whether a person drew the box or the detector produced it. Detector boxes below `min_score` (default 0.7) are hidden; boxes of either origin can be wrong, so compare them with what you see.

### Tool description

<!-- generated:eokg_inspect_image:description -->
> Look at an image source, with the smell-related objects detected in it. Returns the picture itself plus each annotated object (vocabulary concept, bounding box as % of width/height from the top-left, and origin: manual boxes were drawn by the Odeuropa team, detector boxes come from an object detector with a confidence score). Detector boxes can be wrong; compare them with what you see. Use these boxes rather than estimating coordinates yourself. The picture is returned to you only. To show it to the user, call eokg_view_image; never embed an image URL as a Markdown image (![](…)). Takes a source id from eokg_get_source, eokg_get_smell (source.id) or eokg_find_visual_smells.
<!-- /generated -->

### Parameters

<!-- generated:eokg_inspect_image:parameters -->
| Param | Type | Default | Description |
|---|---|---|---|
| `id` | string (≤ 300) | **required** | Image source id: a http://data.odeuropa.eu/source/<uuid> URI or bare uuid. |
| `min_score` | number (0–1) | `0.7` | Hide detector boxes scoring below this (0-1, default 0.7). Hand-drawn boxes score 1 but are not verified and can carry the wrong label. |
<!-- /generated -->

## `eokg_view_image`

Opens an interactive viewer for an image source beside the tool result, in clients that support MCP Apps. The viewer loads the picture from `data.odeuropa.eu` itself, so no image bytes pass through the server or the model's context. Zoom with the wheel or pinch, pan by dragging, double-click to reset.

The graph's object boxes start hidden, because many carry the wrong label. The viewer's Boxes button (or the `b` key) shows and hides them. `show_boxes` only sets the button's starting state; an open viewer cannot be switched from the chat, so a request to show the boxes opens a new viewer with `show_boxes: true`. With boxes on, selecting one shares it with the model as context, and "Send to chat" posts it as a message. The result always lists the objects, so the model can answer questions about them. Hosts without MCP Apps get the Record and Image links as plain text.

### Tool description

<!-- generated:eokg_view_image:description -->
> Show an artwork image to the user in an interactive viewer they can zoom. The viewer appears beside this result in clients that support MCP Apps (Claude, ChatGPT and others). Object boxes start hidden, and the user can turn them on and off with the viewer's Boxes button. Set show_boxes true only when the user asks to see them, since many boxes carry the wrong label. When boxes are on, the user can select one, and the selection is shared with you. Nothing is returned for you to look at; use eokg_inspect_image to see the picture yourself. If the user says no viewer appeared, give them the Record and Image links from the result as plain links. Takes a source id from eokg_search_smells (source_id), eokg_get_source or eokg_find_visual_smells.
<!-- /generated -->

### Parameters

<!-- generated:eokg_view_image:parameters -->
| Param | Type | Default | Description |
|---|---|---|---|
| `id` | string (≤ 300) | **required** | Same as `eokg_inspect_image`. |
| `min_score` | number (0–1) | `0.7` | Same as `eokg_inspect_image`. |
| `show_boxes` | bool | `false` | Draw the object boxes on the image. Leave false unless the user asks to see the boxes; many carry the wrong label. |
<!-- /generated -->

## Data caveats

The knowledge graph is the output of automatic pipelines over historical material. Tool results repeat these caveats where they matter; a model (and a reader) should too.

- **Excerpts are raw OCR text.** Expect mojibake (`Â £`), spaced punctuation (`soaps , English`) and hyphenation splits (`fe - * melle`). Quote verbatim and mark errors with [sic]; search period spellings.
- **Emotions are inferred.** A classifier assigns them, not the text: Rose smells carry "nostalgia" 2,585 times and "gratitude" 2,358 times. Treat them as a model's reading.
- **Dates are noisy.** Timelines contain years such as -1000, 180, 2100 and 4830, a 1989 trade journal sits in the corpus, and 537 Rose smells have no date at all.
- **The emission date is almost always the document date.** It is meant to be when the smell occurs, but only 10 of 8,393 dated Tobacco smells differ from the document date, so `emission_timeline` rarely differs from `timeline`. For an event described long after it happened, date the experience from the passage.
- **Words without an operator are OR-ed, and accents must match.** `tobacco and smoke` gives 1,254,625 hits and `tobacco AND smoke` 3,478; `égouts` gives 594 and `egouts` 22. Write AND/OR/NOT in capitals, quote phrases and hyphenated words, and search both accented and plain forms.
- **German and Slovenian are barely linked to concepts.** Rose has 0 German smells and Tobacco 2; Flower with narrower concepts has 142 German smells of 168,243. Many Slovenian smells have only the words used and no concept. Concept profiles undercount these languages; use full-text search.
- **Filtered search is windowed.** Language, year and dataset filters run after Lucene ranking, on the top 1,000, 5,000 or 20,000 hits. For Italian Rose smells from 1600 to 1800, a window of 1,000 keeps 4 and a window of 20,000 keeps 37; matches beyond the window are not examined.
- **Only two vocabularies can be counted.** They are olfactory-objects and fragrant-spaces; olfactory-gestures is linked to image smells, but no tool profiles it yet. The expert-taxonomy "rose" has zero smells; use the olfactory-objects Rose (`olfactory-objects/138`).
- **Iconclass links in the KG are broken.** Its `skos:closeMatch` values are single characters (`/2`, `/G`, `/(`). The server uses Odeuropa's curated tables instead: Rose maps to `25G41(...)`, and a `(...)` suffix is a placeholder to be completed (for example `25G41(ROSE)`) and verified with an Iconclass server.
- **Places, carriers and quality labels are raw strings.** Top places for Rose include "jardin" (84), "chambre" (62) and "in" (22); top carriers are mostly "the", "it", "they"; quality labels mix languages ("fragrant"@en, "aromatique"@fr).
- **Image detections can be wrong.** Detector boxes have a mean confidence of about 0.76; only boxes scoring exactly 1.0 were drawn by hand. Look at the picture with `eokg_inspect_image`.
