---
name: odeuropa-eokg
description: Research guidance for the Odeuropa European Olfactory Knowledge Graph (about 2.4 million machine-extracted smell references from European texts and artworks, mostly 1600–1920, in English, French, Italian, Slovenian, German and Dutch). Use whenever the user asks about smells, scents, odours, perfume, fragrance, stench or olfactory history, historical sensory history, the Odeuropa Smell Explorer, how a smell source (rose, lavender, tobacco, a garden, a church) was described over time or across languages, or smells in paintings and prints, including in French, German, Italian or Dutch (odeur, parfum, Geruch, Duft, odore, profumo, geur), and any time an eokg_ tool is about to be called.
metadata:
  last_updated: "2026-10-30"
---

# European Olfactory Knowledge Graph (EOKG)

The `eokg_*` tools search the European Olfactory Knowledge Graph (EOKG), built by
the Odeuropa project. The tool descriptions document the parameters; this skill
covers what the graph actually contains, which assumptions quietly fail, and the
call sequences that work. Counts here are approximate; `eokg_list_datasets`
holds the dated snapshot, and `eokg_get_concept` gives live per-concept counts.

## The graph at a glance

- **What was extracted.** NLP pipelines read digitised European texts and picked out
  passages that describe a smell; an object detector (plus some manual annotation)
  found smell-related objects in artworks. Nothing is hand-curated except the
  vocabularies, the manual image boxes and the `text-annotation` benchmark. Treat
  every record as a model's reading of a source.
- **Scale and period.** About 2.4 million smell references in 21 datasets (named
  graphs), mostly 1600–1920. Two datasets (`medical-heritage`, `gallica`) hold
  well over half; ask `eokg_list_datasets` rather than trusting this paragraph.
- **Languages.** Text sources are mostly English, then French; Italian, Slovenian,
  German and Dutch are thin (a few thousand sources each). Expect English-heavy
  results unless you filter or search in the other language.
- **Images.** About 109,000 images are catalogued, but only about 44,000 carry a
  smell; around 24,000 of them carry boxes (detector or manual). `eokg_find_visual_smells` lists every image catalogued as
  representing the concept: boxed ones first, by detector confidence, then
  catalogue-only links with no box.
- **Vocabularies.** 20 vocabularies exist in the Skosmos service, but only
  `olfactory-objects` (what smells: Rose, Lavender, Tobacco), `fragrant-spaces`
  (where: Garden, Church) and `olfactory-gestures` (how people smelled: holding
  one's nose, perfuming) can be profiled. Some gestures come mostly from texts (Perfuming:
  1,655 smells, nearly all French) and others mostly from images (Holding one's nose: 415);
  the other vocabularies are not linked.
  See `references/vocabularies.md`.

## What a smell record is (and is not)

A **smell** is one extracted reference, not a documented odour event. It has:

- an **excerpt** (the extracted passage; absent for image smells) and a **source**
  (the whole book, article or image). The excerpt is a fragment, the source is the
  document around it: use `eokg_get_source` for the latter.
- a **smell source** in two parts: the vocabulary `concept` (what the model
  classified it as) and the `mention` (the words actually used in the text).
- optional roles: carrier, gesture, place, perceiver, time, qualities (adjectives),
  emotions. Roles are extracted; many smells have only some of them. An image smell found
  through a gesture may have nothing else but its date.
- **two dates.** The *document date* is when the source was created and drives
  `year_from`/`year_to` and the profile timeline. The *emission date* is meant to be
  the smell's own time, but in almost every record it equals the document date (10 of
  8,393 dated Tobacco smells differ). Both include noise. For an event (Waterloo in
  1815, described in an 1870 edition of Charles Bell's letters), date the experience
  from the passage itself.
- **emotions** assigned by a classifier. They are not in the text and are a weak
  signal: use them to compare concepts or periods, never quote them as what the
  writer felt.

## Traps

**Filtered search is windowed.** `eokg_search_smells` ranks by relevance first and
applies `language`, `year_*` and `dataset` afterwards to the top 1,000 (then 5,000,
then 20,000) hits. *Symptom:* a filtered search returns few or no results although
the term is common. The result states how many hits were scanned. *Fix:* make the
query itself more specific (a phrase, the language's own word), not just the
filter; for counts by language, period or dataset use `eokg_smell_profile`, which
counts everything for a concept.

**One passage, several results.** Each smell event extracted from a passage is its
own record. *Symptom:* two results with the same excerpt but different ids and
concepts (Lavender and Essence). *Fix:* count passages, not results, when you say
how often something is mentioned; cite the record whose concept you mean.

**Emotions are missing for whole datasets.** The classifier was never run on
`medical-heritage`, `royal-society-corpus`, `old-bailey-corpus` or the benchmark, and
there is no German or Slovenian model, so `dta` and `dlib` have none. *Symptom:* an
emotion profile for a German or Slovenian concept is nearly empty, and an English one
ignores the largest English dataset. *Fix:* compare emotions only across concepts or
periods drawn from the same datasets; check the `datasets` facet first.

**No field prefixes.** Do not write `source_value:rose`; the server picks the field
(`in`: excerpt, title or both). Lucene operators work: `"phrase"`, `AND`/`OR`,
parentheses, `*`. Words without an operator are OR-ed: `tobacco and smoke` gives
1,254,625 hits, `tobacco AND smoke` 3,478. Quote hyphenated words (`"eau de cologne"`),
or they split into OR-ed words; the result adds a hint for both cases. `NOT` needs a
positive term (`smell NOT tobacco`). A trailing `*` matches every word with that
prefix (`Jew*` also finds "jewels"), so read the hits. *Symptom:* a Lucene syntax error (unbalanced
parenthesis or quote) comes back as a correctable error; fix the query and retry.

**OCR spelling.** Matching is on raw, unnormalised OCR text from 1600–1920. *Symptom:*
a modern spelling finds only a fraction of the passages. *Fix:* search period
spellings (`savour`, `perfum'd`, `odeur` vs `odor`), and each language's own word
(`rosa OR rose` for Italian; `puanteur` for French stench). OCR reads the long s as
f: `fmell` alone gives 36,672 hits, and `fweet` and `fmoke` also occur. Accents and
umlauts must match exactly (`égouts` 594 hits, `egouts` 22), so search both forms. A
concept-level profile is not affected, because it counts the classified concept.

**False friends.** Older German *Duft* also means hoarfrost; Italian *odore* also
means fame or a hint; French *sentir* also means to feel. *Fix:* read the excerpt
before counting it as a smell.

**Undated sources.** Text search keeps sources with no date when you give
`year_from`/`year_to`; visual search drops them. Some Old Bailey sessions have no date
field and carry the date only in their long title, and dates such as `XXXX-09-08`
count as undated. *Symptom:* a period-filtered text search lists results marked
"undated" (the result says how many), and an artwork search for the same period
seems smaller. *Fix:* read the date on each result, and say so when a time-bounded
claim rests on a mixed set.

**One passage in several datasets.** `text-annotation` holds hand-annotated copies of
passages that also sit in other datasets (Kostanjevec's *Noč*, 1902, appears in
`dlib`, in *Ljubljanski zvon* and in `text-annotation`, each with different roles).
*Fix:* count passages, not records.

**Raw place and carrier strings.** The `places` facet is unnormalised text ("jardin",
"in"). The `carriers` facet mixes vocabulary concepts (Air, Jug) with raw words ("the",
"in the air"), and one smell can count under both. *Symptom:* function words and a mix
of languages among the top values. *Fix:* use `fragrant_spaces` (vocabulary-linked) for
"where"; treat raw places and carriers as hints, and do not add up carrier counts.

**Counts are relative.** The corpus grows steeply after 1800 and its datasets differ
in size, so almost every concept rises over time. *Symptom:* a timeline that looks
like a historical trend. *Fix:* compare concepts, languages or periods with each
other (shares, not raw counts), and never present one concept's raw curve as how
often people smelled it.

**Timeline noise.** Years like -1000, 180, 2100 and 4830 appear, and the occasional
20th-century journal. The profile reports such years as `out_of_range` instead of
bucketing them. *Fix:* quote the in-range counts, mention out-of-range counts, and
never read a spike in one bucket as history before checking which dataset produced it.

**The expert taxonomy is not linked.** `expert-taxonomy` (and the other descriptive
vocabularies) have a "rose" too, but no smell points at it. *Symptom:* a concept id
from `vocab: "all"` gives zero smells. *Fix:* use `olfactory-objects` ids for what
smells, `fragrant-spaces` ids for where, and `olfactory-gestures` ids for how.

**German and Slovenian are barely linked to concepts.** Rose has 0 German smells,
Tobacco 2, and Flower with its narrower concepts 142 of 168,243. Many Slovenian smells
have only the words used (`gnilobi`) and no concept. *Fix:* for these languages,
full-text search has to carry the question; a concept profile undercounts.

**Topics outside the vocabulary.** There is no concept for battlefield or corpse.
*Fix:* use full-text search.

**Substances have no images.** Coffee (4,571 smells), Incense (9,673) and Sulphur
(8,661) have 0 image sources; Coffeepot has 76. *Fix:* use a related object concept;
`eokg_get_concept` lists related ones.

**Iconclass placeholders.** The KG's own Iconclass links are corrupt, so the server
uses Odeuropa's curated tables. A notation ending in `(...)` (Rose: `25G41(...)`)
is a placeholder meaning "with NAME". *Fix:* fill the name only as a candidate
(`25G41(ROSE)`) and, if possible, verify it with an Iconclass server before presenting
it (see MCP Server Handoffs).

**Image boxes can be wrong, hand-drawn ones included.** A detector box has a
confidence below 1; boxes scoring exactly 1 were drawn by hand (`origin: manual`).
Both kinds can carry the wrong label. Score 1 means drawn by hand, not checked.
Below 0.7, about one detector label in four is wrong, so both image tools hide those
boxes by default (`min_score`). *Symptom:* a "Peach" box over a lemon; a
manual "Meat" box on a bread roll. *Fix:* call `eokg_inspect_image`, look at the
picture, and report what you see against each label, whatever its origin.

**Slow calls.** `include_narrower` on a broad concept (Flower, Flora) takes 15–30
seconds per facet and some facets may fall into `failed_facets`; ask for few
facets, or profile the specific concept. A facet can land there without
`include_narrower` too, and its warning says what to do: a facet that only ran out of
the budget it shares with others can be requested on its own, but a query that timed
out by itself is likely to do so again, so make it smaller instead of repeating it.

## Research patterns

### 1. How did writers describe the smell of X over time?

1. `eokg_find_concepts({ query: "lavender" })` → pick the olfactory-objects id
   (e.g. `olfactory-objects/415`). Check the label language and the broader concept.
2. `eokg_smell_profile({ concept, facets: ["timeline", "qualities", "datasets"] })`
   → look for: which periods have enough data (small buckets are noise), which
   adjectives dominate, and whether one dataset drives a peak.
   To show change, run the `qualities` facet once per period with `year_from` and
   `year_to` rather than quoting all-period qualities. These count by document date,
   so undated sources drop out, and images (datasets `odor`, `europeana`, `nuk`,
   `rijksmuseum`) can be half of a period's smells (the profile warns when they are
   over a quarter). A timeline mixes text and image smells.
   Add `facets: ["smell_sources"]` to see which other smell sources occur in the same
   smells ("which smells appear together").
3. `eokg_search_smells({ text: "\"lavender\" AND (sweet OR fragrant)", year_from, year_to })`
   once per period you want to compare → look for: exemplary passages, spelling
   variants, and the `scanned` window note.
4. `eokg_get_smell` on the passages you will cite, to get title, date, dataset and
   `explorer_url`.

### 2. Compare languages

- Concept view: `eokg_smell_profile({ concept, language: "fr" })`, repeated per
  language, with `facets: ["timeline", "qualities"]`. (`language` cannot be combined
  with `include_narrower`.) Compare shares, not raw counts: English dominates.
- Passage view: `eokg_search_smells` with each language's own term and
  `language` set (`rose` / `rosa` / `Rose` / `roos` / `vrtnica`). Labels in up to six
  languages are on `eokg_get_concept`.
- Look for: different qualities by language, and whether a dataset (see the
  `datasets` facet) explains a difference that looks like a language effect.

### 3. Smells of a place type

1. `eokg_find_concepts({ query: "garden", vocab: "fragrant-spaces" })`.
2. `eokg_smell_profile({ concept: "fragrant-spaces/27", facets: ["smell_sources", "timeline", "datasets", "qualities"] })`
   → fragrant-spaces concepts count smells perceived in such a place. `smell_sources`
   says what smells there: the vocabulary concepts linked as sources of those smells
   (many smells have no linked concept, so the counts are a lower bound). `qualities`
   says how it smells, not what. Check the `datasets` facet before reading a difference as national:
   Hospital has 677 French smells against 215 English, almost all from Gallica.
3. `eokg_search_smells` for exemplary passages ("garden" with a smell word), then
   `eokg_get_smell` to cite. Raw `places` are only a hint.

### 4. Text and image together

1. `eokg_find_visual_smells({ concept: "olfactory-objects/138", year_from, year_to })`
   → artworks with hand-drawn boxes first, then by detector confidence; note title,
   artist and date. Hundreds of hand-drawn images can precede the first detector-only one.
   Images with only low-confidence boxes are hidden and counted; `min_score: 0` brings them back.
2. `eokg_inspect_image({ id })` → look at the picture; compare boxes with what you see.
   The user does not see this picture. To show it, call `eokg_view_image({ id })`,
   which opens a viewer; never embed the image as a Markdown image. Boxes start
   hidden and the user can switch them with the viewer's Boxes button; pass
   `show_boxes: true` only when the user asks to see them. Some clients drop MCP image
   results (the Anthropic API's MCP connector does). If no picture comes through, say
   so, describe the work from its title and box labels only, and call the labels
   unchecked.
3. `eokg_find_concepts` for the same object in other languages, then
   `eokg_search_smells` for the same concept in texts of the same period.
4. Compare: what texts say about the smell, what artists chose to depict. Keep
   the two evidence types separate in the write-up.

### 5. Show or describe a named artwork

Aim for two tool calls.

1. `eokg_search_smells({ text: "\"smoking equipment\"", in: "title" })` with distinctive
   words from the title. Titles carry no artist names, and the artist is not searchable.
   Each hit is one smell, so the same work can appear several times; group hits by
   `source_id`, and keep hits with `source_type: "image"`.
2. Pick the best title and date match. To show it, call `eokg_view_image({ id: source_id })`;
   to describe it yourself, call `eokg_inspect_image` too. `eokg_get_smell` and
   `eokg_get_source` are not needed for this.
3. Mention other candidates from the hit list by title and date without opening them,
   and offer to open one. Near-identical titles with the same date can be two records
   of one painting.

### 6. Gestures

1. `eokg_find_concepts({ query: "holding" })` → pick an `olfactory-gestures` id
   (`olfactory-gestures/2` is holding one's nose).
2. `eokg_find_visual_smells({ concept: "olfactory-gestures/2" })` → the Raisings of
   Lazarus come first for holding one's nose.
3. `eokg_inspect_image({ id })` → look at the picture.

For a gesture found mostly in texts (Perfuming, `olfactory-gestures/29`), use
`eokg_smell_profile` instead: its default `smell_sources` facet shows which smell
sources occur with the gesture. Then search passages in the source language.

Check where a gesture's evidence comes from before comparing gestures: Holding one's
nose is almost all images, Perfuming almost all French texts. The `datasets` facet of
`eokg_smell_profile` shows which.

### 7. Allegories of the senses

They can only be found through title words: `eokg_search_smells({ text: "allegory AND smell", in: "title" })`.
Iconclass 31A33 (smell) maps to no Odeuropa concept.

## Citing

Give, for each smell: the `explorer_url`, the source title, date and dataset. The
link is `https://explorer.odeuropa.eu/smells/<id>` with the smell id from any result,
so it needs no extra call. Quote excerpts verbatim. The artist field can carry
provenance or attribution notes ("Jan Breughel as such in Dorotheum Vienne,
2015-10-20"); quote the artist name only. Where OCR damage is
visible, mark it with [sic] rather than silently fixing it (`soaps , English`,
`Â £`). Say whether a date is the document date or the emission date. Emotions come from
the classifier, not the author. Qualities are words the extractor picked out of the
passage, some normalised (*Pleasant*, *Unpleasant*): quote the passage, not the facet,
when you attribute a word to a writer. Odeuropa is
the data provider; cite it as such (EU Horizon 2020, grant 101004469).

## MCP Server Handoffs

These servers may not be installed. When one is missing, say so and point the user to
its repository.

- **Iconclass** (https://github.com/kintopp/rijksmuseum-iconclass-mcp). A candidate
  notation from a `(...)` placeholder should, if possible, be checked with this server
  (`resolve`/`search`) before you present it as valid. Without it, present the
  notation as unverified.
- **Rijksmuseum** (https://github.com/kintopp/rijksmuseum-mcp-plus). `25G41(ROSE)`-style
  notations work as the `iconclass` filter on its artwork search, to find collection
  works on the same subject.
- **Reverse.** Given a notation from either server, `eokg_find_concepts({ iconclass })`
  returns the Odeuropa concepts mapped to it or to broader or narrower notations.
- **References.** `references/vocabularies.md` for the 20 vocabularies and which are
  linked; `references/data-quality.md` for worked examples of the traps above;
  `references/datasets.md` before explaining a peak or a language difference from
  the `datasets` facet; `references/extraction.md` before judging how reliable a
  count, an emotion or an image label is.
