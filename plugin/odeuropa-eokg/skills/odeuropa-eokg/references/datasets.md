# Datasets: what each graph holds

Condensed from Odeuropa deliverables (CC-BY 4.0), https://odeuropa.eu/deliverables/, and the Odeuropa knowledge-graph repository (Apache-2.0), commit 4c188f7, https://github.com/Odeuropa/knowledge-graph, cited as "KG repo" with a file path. Also from the ARTFL pages for the Bibliothèque bleue (https://artfl-project.uchicago.edu/bibliotheque-bleue) and Grimm's *Correspondance littéraire* (https://artfl-project.uchicago.edu/grimms-correspondance-litteraire), Zenodo records cited by DOI, and "Odeuropa project records", the consortium's internal working documents. Figures describe the pipeline as reported at the time.

Read this before explaining a peak or a language difference from the `datasets` facet. Dataset ids are the names `eokg_list_datasets` returns. Smell counts change, so take them from that tool.

Deliverables cited: D2.4 and D2.5 (images), D3.2 (corpora and benchmark), D3.4 and D3.5 (text pipeline), D4.2 and D4.3 (graph versions 1 and 2). Page numbers are the printed ones.

## What D4.3 describes

D4.3 (June 2023) describes a smaller graph than today's: 718,375 smells from 694,505 sentences in 62,727 textual resources, plus 23,870 images (D4.3 p. 9). It lists 16 graphs (Table 4, p. 10), with all images in one `image-annotation` graph. The graph now holds several times as many smells (see `eokg_list_datasets`). Five datasets in the graph today are absent from D4.3 Table 4 and were loaded after it: `medical-heritage`, `odor`, `europeana`, `nuk` and `rijksmuseum`. `eebo` is named in D4.3's text (p. 9) but is also absent from Table 4. The conversion code's input files describe all six (KG repo, populate/input/).

Text came from three runs (D4.3 p. 9): the hand-annotated benchmark, text pipeline version 1, and pipeline version 2, which at that point covered only EEBO, British Library, the English part of Gutenberg, Pulse and ECCO. The other text graphs come from the benchmark or version 1. See `extraction.md` for the scores.

## Text datasets

The corpora were collected as freely available, copyright-free digitisations from 1620 to 1920 (D3.2 p. 7). The last column gives the page of each citation; D4.3 is Table 4, p. 10.

| Dataset | Corpus | Language | Period | Source |
|---|---|---|---|---|
| `gallica` | Gallica, the Bibliothèque nationale de France portal, over 200,000 digitised resources reached through its API | French | the whole 1620–1920 span | D3.2 p. 8; D4.3 |
| `british-library` | British Library Digitised Books, miscellaneous documents; may overlap other repositories | English | not stated | D3.2 p. 8; D4.3 |
| `wikisource` | Wikisource, a wiki library of public-domain or freely licensed works | collected for Dutch, English, German, Italian and Latin; only Italian in D4.3 | German and Italian 1620–1925 | D3.2 pp. 7–10; D4.3 |
| `gutenberg` | Project Gutenberg, volunteer digitisations, mainly literary | collected for Dutch, English, French (4,486 texts), German, Italian, Latin; English and Italian in D4.3 | German and Italian 1620–1925 | D3.2 pp. 7–10; D4.3 |
| `eebo` | EEBO-TCP, the Text Creation Partnership transcripts of Early English Books Online: ids such as `A6/A60020.P4.xml`, links to quod.lib.umich.edu/e/eebo/. Named in D4.3 p. 9 as processed by pipeline version 2; not in Table 4. Phases I and II, about 60,000 texts; in 2023, 82,461 smell sentences from 14,355 books (project records) | English | c. 1500–1700 | D3.2 p. 8; D4.3 p. 9; KG repo, populate/input/eebo/metadata.tsv; Odeuropa project records |
| `ecco` | The TCP eighteenth-century collections | English | 18th century | D3.2 p. 8; D4.3 |
| `dbnl` | Digitale Bibliotheek voor de Nederlandse Letteren: literary, linguistic and cultural-historical texts | Dutch | DBNL spans the 12th to 21st century; the corpus was collected for 1620–1920 | D3.2 p. 7; D4.3 |
| `liberliber` | LiberLiber, an Italian non-profit library; about 3,000 books in D3.2, over 4,000 books and about 230M tokens in D3.4 | Italian | 1620–1925 | D3.2 p. 9; D3.4 p. 12; D4.3 |
| `dta` | Deutsches Textarchiv, a cross-section of printed New High German works | German | about 1600–1900 | D3.2 p. 9; D4.3 |
| `dlib` | dLib.si, the Digital Library of Slovenia: books and periodicals (the subcorpora the project focused on) | Slovenian | OCR is decent after the mid to late 19th century and often too poor to use before 1850 | D3.2 pp. 10–11; D3.4 p. 8; D4.3 |
| `pulse` | London's Pulse: Medical Officer of Health reports on public health, sanitation and urban life | English | 1848–1925 | D3.2 p. 8; D4.3 |
| `royal-society-corpus` | Royal Society Corpus: scientific periodicals | English | 1665–1869 | D3.2 p. 8; D4.3 |
| `old-bailey-corpus` | A small pre-processed version of the Old Bailey court proceedings | English | 1720–1913 | D3.2 p. 8; D4.3 |
| `bibbleue` | ARTFL's Bibliothèque bleue de Troyes: cheap books printed in Troyes and sold by peddlers, on practical, religious and entertaining subjects; ARTFL holds 252 titles, 284 with texts from the Bancroft Library. Example: Jehan Lecoq's *Le grand calendrier et compost des bergers* (1541); ids `Bbl…`. The smells come from 271 of its documents, 385 smell sentences (project records); D4.3 lists 385 smells | French | 17th to mid-19th century | ARTFL page; D4.3; KG repo, populate/input/bibbleue/metadata.tsv; Odeuropa project records |
| `grimm` | ARTFL's text of the *Correspondance littéraire, philosophique et critique de Grimm et de Diderot depuis 1753 jusqu'en 1790*, in the 16-volume edition by Taschereau and Chaudé, Paris, Furne, 1829 (`pub_date` 1829–1831 in the metadata). The graph's 64 smells come from all 16 volumes (project records). Each volume's document date is the dateline of its first entry, so the first volume is dated 1753 and later volumes later (KG repo, populate/convert_text.py) | French | 1753–1790 | ARTFL page; D4.3; KG repo, populate/input/grimm/metadata.tsv and populate/convert_text.py; Odeuropa project records |
| `text-annotation` | The Odeuropa benchmark: excerpts from the corpora annotated by hand in ten domains (household and recipes, law, literature, medicine and botany, perfumes and fashion, public health, religion, science and philosophy, theatre, travel and ethnography) | all project languages (D4.3) | 1620–1920 | D3.2 pp. 6, 11–13; D4.3 |
| `medical-heritage` | The UK Medical Heritage Library, in ten parts (`UK-Medical-Heritage-Library-2_0` to `2_9`); metadata links to archive.org and names collections such as rcplondon, ukmhl and medicalheritagelibrary. Not in the deliverables. About 1,005,500 smell sentences from 58,195 books, by far the largest English dataset (project records) | processed as English, though some titles are French | requested for 1600–1925 | KG repo, populate/input/medical-heritage/ and populate/convert_text.py; Odeuropa project records |

Corpus sizes in 2023, as rough scale only (counts change; `eokg_list_datasets` is authoritative): `gallica` 550,609 smell sentences from 44,269 books; `british-library` 345,982 from 39,254; English `wikisource` 160,113 from 9,119; `dlib` 55,013 from 10,177; English `gutenberg` 34,455 from 3,608; `liberliber` 30,432 from 2,554; Italian `wikisource` 22,295 from 1,734; `ecco` 8,497 from 1,595; `pulse` 6,697 from 2,177; `royal-society-corpus` 3,633 from 1,205; `old-bailey-corpus` 1,185 from 319 (Odeuropa project records).

How `text-annotation` was made: annotators in each language, at least two per language, marked smell words and up to ten roles in the INCEpTION tool (D3.5 p. 7), with a checking tool for annotation errors (D3.2 pp. 11–12). The first graph load held the 84 English benchmark documents and 1,530 smells (D4.2 p. 10).

## Image datasets

| Dataset | What the sources say | Source |
|---|---|---|
| `odor` | The hand-annotated ODOR dataset. The graph's hand-drawn object boxes are ODOR v3, the set released on Zenodo in October 2023 as "The Object Detection for Olfactory References (ODOR) Dataset": 38,116 boxes on 4,712 images in 139 categories (10.5281/zenodo.10027116; 3.0.2, 10.5281/zenodo.11070878). The KG repo's README describes the earlier v2 (10.5281/zenodo.7125961: 36,663 boxes, 4,696 images, 169 categories). D2.4 gives v2 as 4,696 images in its abstract and 4,969 images and 170 categories on p. 4; the Zenodo record and its files agree with the abstract, so 4,969 is a slip. The only image dataset with hand-drawn object boxes (`annotations.json`) and gesture boxes (`annotations_gesture.json`); it also has detector boxes (`annotations_automatic.json`). Version 1 (24,391 boxes in 2,937 artworks) was the training set of the ODOR challenge. D4.3 put the ODOR images of its time in one `image-annotation` graph with 23,870 smells | Zenodo records above; KG repo, populate/input/odor/; D2.4 abstract, pp. 4, 7; D2.5 p. 8; D4.3 pp. 9–10 |
| `europeana` | Detector boxes only. Items from several institutions, such as the Wellcome Collection and the Rijksmuseum, reached through data.europeana.eu | KG repo, populate/input/europeana/ |
| `rijksmuseum` | Detector boxes only. Rijksmuseum works; the metadata links to rijksmuseum.nl | KG repo, populate/input/rijksmuseum/ |
| `nuk` | Detector boxes only. Images from dLib.si, the Digital Library of Slovenia. NUK is the National and University Library of Slovenia, which D3.2 also uses for a text subcorpus | KG repo, populate/input/nuk/; D3.2 p. 10 |

The annotated image sets were drawn from museum collections found by search terms such as smell, senses, Lazarus, still life, tobacco and censer (D2.5 p. 8). The deliverables do not name the collections. In the ODOR metadata about three quarters of the images come from RKD: 3,596 of 4,616 rows in v2, 3,609 of 4,881 in v3. The rest come mainly from the Fondazione Zeri photo archive, Bildindex, the French POP platform, the Städel and the Berlin state museums (Zenodo records above).

In September 2023 the detector had been run on 48,514 Odeuropa-collected images, 10,000 from NUK and 38,332 from Europeana (Odeuropa project records); the February 2024 Zenodo dump of the graph reports over 43,000 images (10.5281/zenodo.10709703). Take current counts from `eokg_list_datasets`.

## Reading the `datasets` facet

- Image-only: `odor`, `europeana`, `nuk`, `rijksmuseum`. Every source in them is an image (verified live). A peak that comes from one of them is a peak in pictures. Only `odor` has hand-drawn boxes; the other three hold detector boxes alone (KG repo, populate/input/).
- Hand-annotated: only `text-annotation`. Its excerpts were taken from the same corpora (D3.2 p. 4), so a passage may also appear under a corpus dataset.
- Single-language collections: `gallica`, `bibbleue` and `grimm` are French, `british-library`, `ecco`, `pulse`, `royal-society-corpus` and `old-bailey-corpus` are English, `dbnl` is Dutch, `liberliber` is Italian, `dta` is German, `dlib` is Slovenian (D4.3 Table 4). A profile for Dutch, Italian, German or Slovenian therefore mostly describes one collection. Check the facet before calling a difference national.
- Overlap: Italian Gutenberg mostly repeats Wikisource and LiberLiber, and the Italian repositories overlap each other (D3.4 p. 12). Expect the same text under several dataset ids.
- Genre follows the collection: `pulse` is public-health reports, `royal-society-corpus` is science, `old-bailey-corpus` is court records, `medical-heritage` is medicine (KG repo, populate/input/medical-heritage/). A concept that peaks in one of these reflects the genre.