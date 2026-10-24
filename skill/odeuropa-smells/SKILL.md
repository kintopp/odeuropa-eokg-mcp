---
name: odeuropa-smells
last_updated: 2026-10-23
description: Research guidance for the Odeuropa European Olfactory Knowledge Graph (about 2.4 million machine-extracted smell references from European texts and artworks, mostly 1600–1920, in English, French, Italian, Slovenian, German and Dutch). Use whenever the user asks about smells, scents, odours, perfume, fragrance, stench or olfactory history, historical sensory history, the Odeuropa Smell Explorer, how a smell source (rose, lavender, tobacco, a garden, a church) was described over time or across languages, or smells in paintings and prints, including in French, German, Italian or Dutch (odeur, parfum, Geruch, Duft, odore, profumo, geur), and any time an eokg_ tool is about to be called.
---

# Odeuropa smells

The `eokg_*` tools search the European Olfactory Knowledge Graph (EOKG), built by
the Odeuropa project. The tool descriptions document the parameters; this skill
covers what the graph actually contains, which assumptions quietly fail, and the
call sequences that work. Counts here are approximate; `eokg_list_datasets`
holds the dated snapshot, and `eokg_get_concept` gives live per-concept counts.

## The graph at a glance

- **What was extracted.** NLP pipelines read digitised European texts and picked out
  passages that describe a smell; an object detector (plus some manual annotation)
  found smell-related objects in artworks. Nothing is hand-curated except the
  vocabularies and the manual image boxes. Treat every record as a model's reading
  of a source.
- **Scale and period.** About 2.4 million smell references in 21 datasets (named
  graphs), mostly 1600–1920. Two datasets (`medical-heritage`, `gallica`) hold
  well over half; ask `eokg_list_datasets` rather than trusting this paragraph.
- **Languages.** Text sources are mostly English, then French; Italian, Slovenian,
  German and Dutch are thin (a few thousand sources each). Expect English-heavy
  results unless you filter or search in the other language.
- **Images.** About 109,000 images exist; around 24,000 of them carry boxes
  (detector or manual). `eokg_find_visual_smells` lists every image catalogued as
  representing the concept: boxed ones first, by detector confidence, then
  catalogue-only links with no box.
- **Vocabularies.** 20 vocabularies exist in the Skosmos service, but only
  `olfactory-objects` (what smells: Rose, Lavender, Tobacco) and `fragrant-spaces`
  (where: Garden, Church) are linked to smells. See `references/vocabularies.md`.

## What a smell record is (and is not)

A **smell** is one extracted reference, not a documented odour event. It has:

- an **excerpt** (the extracted passage; absent for image smells) and a **source**
  (the whole book, article or image). The excerpt is a fragment, the source is the
  document around it: use `eokg_get_source` for the latter.
- a **smell source** in two parts: the vocabulary `concept` (what the model
  classified it as) and the `mention` (the words actually used in the text).
- optional roles: carrier, place, perceiver, time, qualities (adjectives), emotions.
  Roles are extracted strings; many smells have only some of them.
- **two dates.** The *document date* is when the source was created and drives
  `year_from`/`year_to` and the profile timeline. The *emission date* is the
  smell's own time, extracted from the text; request it explicitly
  (`emission_timeline`). They answer different questions and both include noise.
- **emotions** assigned by a classifier. They are not in the text; never quote them
  as what the writer felt.

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

**No field prefixes.** Do not write `source_value:rose`; the server picks the field
(`in`: excerpt, title or both). Lucene operators work: `"phrase"`, `AND`/`OR`,
parentheses, `*`. *Symptom:* a Lucene syntax error (unbalanced parenthesis or quote)
comes back as a correctable error; fix the query and retry.

**OCR spelling.** Matching is on raw, unnormalised OCR text from 1600–1920. *Symptom:*
a modern spelling finds only a fraction of the passages. *Fix:* search period
spellings (`savour`, `perfum'd`, `odeur` vs `odor`), and each language's own word
(`rosa OR rose` for Italian; `puanteur` for French stench). A concept-level
profile is not affected, because it counts the classified concept.

**Undated sources.** Text search keeps sources with no date when you give
`year_from`/`year_to`; visual search drops them. *Symptom:* a period-filtered text
search includes records with no date at all, but an artwork search for the same
period seems smaller. *Fix:* read the date on each result, and say so when a
time-bounded claim rests on a mixed set.

**Raw place and carrier strings.** `places` and `carriers` facets are unnormalised
text ("jardin", "in", "the", "it"). *Symptom:* function words and a mix of
languages among the top values. *Fix:* use `fragrant_spaces` (vocabulary-linked) for
"where"; treat raw places and carriers as hints, never as counts of places.

**Counts are relative.** The corpus grows steeply after 1800 and its datasets differ
in size, so almost every concept rises over time. *Symptom:* a timeline that looks
like a historical trend. *Fix:* compare concepts, languages or periods with each
other (shares, not raw counts), and never present one concept's raw curve as how
often people smelled it. Emotions are only a weak signal: a classifier assigns
them, so use them only to compare, never as what the writer felt.

**Timeline noise.** Years like -1000, 180, 2100 and 4830 appear, and the occasional
20th-century journal. The profile reports such years as `out_of_range` instead of
bucketing them. *Fix:* quote the in-range counts, mention out-of-range counts, and
never read a spike in one bucket as history before checking which dataset produced it.

**The expert taxonomy is not linked.** `expert-taxonomy` (and the other 17 descriptive
vocabularies) have a "rose" too, but no smell points at it. *Symptom:* a concept id
from `vocab: "all"` gives zero smells. *Fix:* use `olfactory-objects` ids for
what smells and `fragrant-spaces` ids for where.

**Iconclass placeholders.** The KG's own Iconclass links are corrupt, so the server
uses Odeuropa's curated tables. A notation ending in `(...)` (Rose: `25G41(...)`)
is a placeholder meaning "with NAME". *Fix:* fill the name only as a candidate
(`25G41(ROSE)`) and verify it with an Iconclass server before presenting it.

**Image boxes can be wrong, hand-drawn ones included.** A detector box has a
confidence below 1; boxes scoring exactly 1 were drawn by hand (`origin: manual`).
Both kinds can carry the wrong label. Score 1 means drawn by hand, not checked.
Below 0.7, about one detector label in four is wrong, so both image tools hide those
boxes by default (`min_score`). *Symptom:* a "Peach" box over a lemon; a
manual "Meat" box on a bread roll. *Fix:* call `eokg_inspect_image`, look at the
picture, and report what you see against each label, whatever its origin.

**Slow calls.** `include_narrower` on a broad concept (Flower, Flora) takes 15–30
seconds per facet and some facets may fall into `failed_facets`; ask for few
facets, or profile the specific concept. A timed-out query is not retried.

## Research patterns

### 1. How did writers describe the smell of X over time?

1. `eokg_find_concepts({ query: "lavender" })` → pick the olfactory-objects id
   (e.g. `olfactory-objects/415`). Check the label language and the broader concept.
2. `eokg_smell_profile({ concept, facets: ["timeline", "qualities", "datasets"] })`
   → look for: which periods have enough data (small buckets are noise), which
   adjectives dominate, and whether one dataset drives a peak.
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
  `language` set (`rose` / `rosa` / `Rose` / `roos` / `vrtnica`). Labels in all six
  languages are on `eokg_get_concept`.
- Look for: different qualities by language, and whether a dataset (see the
  `datasets` facet) explains a difference that looks like a language effect.

### 3. Smells of a place type

1. `eokg_find_concepts({ query: "garden", vocab: "fragrant-spaces" })`.
2. `eokg_smell_profile({ concept: "fragrant-spaces/27", facets: ["timeline", "datasets", "qualities"] })`
   → what smells co-occur there; fragrant-spaces concepts count smells perceived in
   such a place.
3. `eokg_search_smells` for exemplary passages ("garden" with a smell word), then
   `eokg_get_smell` to cite. Raw `places` are only a hint.

### 4. Text and image together

1. `eokg_find_visual_smells({ concept: "olfactory-objects/138", year_from, year_to })`
   → artworks with hand-drawn boxes first, then by detector confidence; note title,
   artist and date. Hundreds of hand-drawn images can precede the first detector-only one.
   Images with only low-confidence boxes are hidden and counted; `min_score: 0` brings them back.
2. `eokg_inspect_image({ id })` → look at the picture; compare boxes with what you see.
   The user does not see the picture, and the chat cannot display it: say so, and give
   the Record and Image links as plain links, never as a Markdown image.
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
2. Pick the best title and date match and call `eokg_inspect_image({ id: source_id })`
   directly; `eokg_get_smell` and `eokg_get_source` are not needed for this.
3. Mention other candidates from the hit list by title and date without opening them,
   and offer to open one. Near-identical titles with the same date can be two records
   of one painting.

## Citing

Give, for each smell: the `explorer_url` (`https://explorer.odeuropa.eu/smells/…`),
the source title, date and dataset. Quote excerpts verbatim. Where OCR damage is
visible, mark it with [sic] rather than silently fixing it (`soaps , English`,
`Â £`). Say whether a date is the document date or the emission date. Attribute
emotions and qualities to the extraction, not to the author. Odeuropa is
the data provider; cite it as such (EU Horizon 2020, grant 101004469).

## Handoffs

- **Iconclass.** A candidate notation from `(...)` placeholders must be checked
  with an Iconclass server (`resolve`/`search`) before you present it as valid.
- **Rijksmuseum.** `25G41(ROSE)`-style notations work as the `iconclass` filter on
  the Rijksmuseum server's artwork search, to find collection works on the same subject.
- **Reverse.** Given a notation from either server, `eokg_find_concepts({ iconclass })`
  returns the Odeuropa concepts mapped to it or to broader or narrower notations.
- **References.** `references/vocabularies.md` for the 20 vocabularies and which are
  linked; `references/data-quality.md` for worked examples of the traps above.
