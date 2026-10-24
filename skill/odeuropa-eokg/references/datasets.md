# Datasets: what each graph holds

Condensed from Odeuropa deliverables (CC-BY 4.0), https://odeuropa.eu/deliverables/. Figures describe the pipeline as reported at the time.

Read this before explaining a peak or a language difference from the `datasets` facet. Dataset ids are the names `eokg_list_datasets` returns. Smell counts change, so take them from that tool.

Deliverables cited: D2.4 and D2.5 (images), D3.2 (corpora and benchmark), D3.4 and D3.5 (text pipeline), D4.2 and D4.3 (graph versions 1 and 2). Page numbers are the printed ones.

## What D4.3 describes

D4.3 (June 2023) describes a smaller graph than today's: 718,375 smells from 694,505 sentences in 62,727 textual resources, plus 23,870 images (D4.3 p. 9). It lists 16 graphs (Table 4, p. 10), with all images in one `image-annotation` graph. The graph now holds several times as many smells (see `eokg_list_datasets`). Datasets that are in the graph today but absent from D4.3 Table 4 were loaded after it: `medical-heritage`, `eebo`, `odor`, `europeana`, `nuk` and `rijksmuseum`. Their contents are not described below.

Text came from three runs (D4.3 p. 9): the hand-annotated benchmark, text pipeline version 1, and pipeline version 2, which at that point covered only EEBO, British Library, the English part of Gutenberg, Pulse and ECCO. The other text graphs come from the benchmark or version 1. See `extraction.md` for the scores.

## Text datasets

The corpora were collected as freely available, copyright-free digitisations from 1620 to 1920 (D3.2 p. 7). The last column gives the page of each citation; D4.3 is Table 4, p. 10.

| Dataset | Corpus | Language | Period | Source |
|---|---|---|---|---|
| `gallica` | Gallica, the Bibliothèque nationale de France portal, over 200,000 digitised resources reached through its API | French | the whole 1620–1920 span | D3.2 p. 8; D4.3 |
| `british-library` | British Library Digitised Books, miscellaneous documents; may overlap other repositories | English | not stated | D3.2 p. 8; D4.3 |
| `wikisource` | Wikisource, a wiki library of public-domain or freely licensed works | collected for Dutch, English, German, Italian and Latin; only Italian in D4.3 | German and Italian 1620–1925 | D3.2 pp. 7–10; D4.3 |
| `gutenberg` | Project Gutenberg, volunteer digitisations, mainly literary | collected for Dutch, English, French (4,486 texts), German, Italian, Latin; English and Italian in D4.3 | German and Italian 1620–1925 | D3.2 pp. 7–10; D4.3 |
| `eebo` | Named in D4.3 p. 9 as processed by pipeline version 2; not in Table 4. Closest corpus entry: Text Creation Partnership transcripts of early English books | English (the TCP entry) | not stated | D3.2 p. 8; D4.3 p. 9 |
| `ecco` | The TCP eighteenth-century collections | English | 18th century | D3.2 p. 8; D4.3 |
| `dbnl` | Digitale Bibliotheek voor de Nederlandse Letteren: literary, linguistic and cultural-historical texts | Dutch | DBNL spans the 12th to 21st century; the corpus was collected for 1620–1920 | D3.2 p. 7; D4.3 |
| `liberliber` | LiberLiber, an Italian non-profit library; about 3,000 books in D3.2, over 4,000 books and about 230M tokens in D3.4 | Italian | 1620–1925 | D3.2 p. 9; D3.4 p. 12; D4.3 |
| `dta` | Deutsches Textarchiv, a cross-section of printed New High German works | German | about 1600–1900 | D3.2 p. 9; D4.3 |
| `dlib` | dLib.si, the Digital Library of Slovenia: books and periodicals (the subcorpora the project focused on) | Slovenian | OCR is decent after the mid to late 19th century and often too poor to use before 1850 | D3.2 pp. 10–11; D3.4 p. 8; D4.3 |
| `pulse` | London's Pulse: Medical Officer of Health reports on public health, sanitation and urban life | English | 1848–1925 | D3.2 p. 8; D4.3 |
| `royal-society-corpus` | Royal Society Corpus: scientific periodicals | English | 1665–1869 | D3.2 p. 8; D4.3 |
| `old-bailey-corpus` | A small pre-processed version of the Old Bailey court proceedings | English | 1720–1913 | D3.2 p. 8; D4.3 |
| `bibbleue` | Listed in D4.3 as a text graph with 385 smells; no corpus description | French | not stated | D4.3 |
| `grimm` | Listed in D4.3 as a text graph with 40 smells; no corpus description | French | not stated | D4.3 |
| `text-annotation` | The Odeuropa benchmark: excerpts from the corpora annotated by hand in ten domains (household and recipes, law, literature, medicine and botany, perfumes and fashion, public health, religion, science and philosophy, theatre, travel and ethnography) | all project languages (D4.3) | 1620–1920 | D3.2 pp. 6, 11–13; D4.3 |
| `medical-heritage` | not described in the deliverables | n/a | n/a | n/a |

How `text-annotation` was made: annotators in each language, at least two per language, marked smell words and up to ten roles in the INCEpTION tool (D3.5 p. 7), with a checking tool for annotation errors (D3.2 pp. 11–12). The first graph load held the 84 English benchmark documents and 1,530 smells (D4.2 p. 10).

## Image datasets

| Dataset | What the deliverables say | Source |
|---|---|---|
| `odor` | Not in D4.3 Table 4. D4.3 says the images come from the ODOR dataset, with manual and automatic annotations, in one graph `image-annotation` with 23,870 smells. The name matches the ODOR challenge, whose training set is the hand-annotated Odeuropa Dataset of Smell-Related Objects (version 1: 24,391 boxes in 2,937 artworks). No deliverable says which current dataset holds which set | D4.3 pp. 9–10; D2.5 p. 8; D2.4 p. 7 |
| `europeana` | not described in the deliverables | n/a |
| `rijksmuseum` | not described in the deliverables | n/a |
| `nuk` | not described as images. D3.2 uses NUK, the National and University Library of Slovenia, for a text subcorpus of older Slovenian books | D3.2 p. 10 |

The annotated image sets were drawn from museum collections found by search terms such as smell, senses, Lazarus, still life, tobacco and censer (D2.5 p. 8). The collections are not named.

## Reading the `datasets` facet

- Image-only: `odor`, `europeana`, `nuk`, `rijksmuseum`. Every source in them is an image (verified live). A peak that comes from one of them is a peak in pictures.
- Hand-annotated: only `text-annotation`. Its excerpts were taken from the same corpora (D3.2 p. 4), so a passage may also appear under a corpus dataset.
- Single-language collections: `gallica`, `bibbleue` and `grimm` are French, `british-library`, `ecco`, `pulse`, `royal-society-corpus` and `old-bailey-corpus` are English, `dbnl` is Dutch, `liberliber` is Italian, `dta` is German, `dlib` is Slovenian (D4.3 Table 4). A profile for Dutch, Italian, German or Slovenian therefore mostly describes one collection. Check the facet before calling a difference national.
- Overlap: Italian Gutenberg mostly repeats Wikisource and LiberLiber, and the Italian repositories overlap each other (D3.4 p. 12). Expect the same text under several dataset ids.
- Genre follows the collection: `pulse` is public-health reports, `royal-society-corpus` is science, `old-bailey-corpus` is court records. A concept that peaks in one of these reflects the genre.
- Not described, or not mapped, in the deliverables: `medical-heritage` (no entry at all), `europeana`, `rijksmuseum`, `nuk` and `odor` (images), and the corpus behind `bibbleue` and `grimm`, which D4.3 lists only by type, language and count. Say so rather than describing them.
