# Extraction: how reliable are the labels

Condensed from Odeuropa deliverables (CC-BY 4.0), https://odeuropa.eu/deliverables/. Figures describe the pipeline as reported at the time.

Read this before judging how reliable a count, an emotion or an image label is. Deliverables cited: D3.2 (benchmark), D3.3 to D3.5 (text), D2.4 and D2.5 (images), D4.1 and D4.2 (graph and vocabularies). D4.3, the final graph description, could not be retrieved. Page numbers are the printed ones.

## Text extraction

Hand-annotated benchmark passages (1620–1920, ten domains, annotated in INCEpTION) trained the token classifiers, so the graph's smells are model predictions (D3.2 p. 11; D3.5 p. 8). The released version labels the smell word and nine roles in one multi-task model built on BERT-type language models. English, French and Slovenian use a monolingual model; Italian, German and Dutch use a model trained on all languages together (D3.5 pp. 9–11). Latin is in the benchmark but is not one of the graph's languages.

Scores are F1 for exact span matches, averaged over ten test folds of the benchmark (D3.5 p. 11). Benchmark passages were chosen for their density of smell words (D3.2 p. 4), and the deliverables report no scores on the full corpus.

| Language | Benchmark smell words | Smell word | Source | Quality | Carrier | Evoked odorant | Place | Perceiver | Time | Circumstances | Effect |
|---|---|---|---|---|---|---|---|---|---|---|---|
| English | 1,530 | 0.87 | 0.57 | 0.76 | 0.48 | 0.57 | 0.54 | 0.51 | 0.43 | 0.46 | 0.41 |
| Italian | 1,254 | 0.89 | 0.58 | 0.80 | 0.38 | 0.63 | 0.30 | 0.24 | 0.64 | 0.31 | 0.20 |
| French | 845 | 0.84 | 0.46 | 0.57 | 0.44 | 0.54 | 0.37 | 0.38 | 0.48 | 0.28 | 0.24 |
| Dutch | 1,788 | 0.79 | 0.41 | 0.64 | 0.21 | 0.47 | 0.24 | 0.31 | 0.34 | 0.15 | 0.19 |
| German | 2,659 | 0.81 | 0.47 | 0.68 | 0.22 | 0.49 | 0.29 | 0.35 | 0.26 | 0.27 | 0.25 |
| Slovenian | 1,973 | 0.71 | 0.50 | 0.53 | 0.32 | 0.51 | 0.40 | 0.36 | 0.28 | 0.15 | 0.15 |

Sources: benchmark counts D3.5 p. 8; scores D3.5 p. 11, Table 3, rows for the released model of each language.

What the figures say:

- Smell words are found best, then qualities, then sources. A source can be any word in the sentence, so it is the hardest of the three core roles (D3.3 p. 11).
- Place, perceiver, time, circumstances and effect rest on few training examples, and most of their errors are span boundaries, such as "flowers" against "of flowers" (D3.5 p. 10).
- A model trained on older English or Dutch text beat the modern one for those two languages. No gain was seen for German or Italian, and the French comparison failed (D3.4 pp. 14, 16). For Slovenian, OCR often reads the long s as f, and OCR before 1850 is often too poor to use (D3.4 p. 8).
- Version 1 covered only smell word, source and quality. D3.5 added the other roles and is the later release, so it is used here (D3.3 p. 6; D3.5 p. 8).
- The benchmark counts changed between releases (German smell words 1,493 in D3.2 p. 13, 2,659 in D3.5 p. 8). The later figure is used here.

Meaning for an answer: on benchmark text, source F1 runs from 0.41 to 0.58 and quality F1 from 0.53 to 0.80. Quote the passage, not the label, and treat the rarer roles (perceiver, time, effect) as hints.

## Linking to concepts

In the first graph load, benchmark labels were matched to the vocabularies by string matching: 32 labels were linked, and the authors suggested lemmatising terms first (D4.2 p. 10). The same load linked 41 of 158 places to GeoNames (D4.2 p. 10). The deliverables available here do not describe the matching used for the full graph.

German explanation: when the vocabularies were published, 172 of the 417 olfactory-objects concepts had a German label, against 400 English, 378 French, 381 Italian and 390 Dutch. Only 4 of 110 fragrant spaces and none of the 35 gestures had a German label (D4.1 p. 12, Table 2). Many German words had no concept to match.

Slovenian is not explained. The same table lists 402 Slovenian labels for objects, and no deliverable says why few Slovenian smells are linked.

Some concepts mix roles. A concept such as smoke can be a source or a carrier, so the vocabulary keeps one list with a preferred role (D4.1 p. 11).

Meaning for an answer: a German count from a concept profile is a floor, not an estimate. Search the German words in the text.

## Emotions

Emotions come from a separate classifier with 38 labels plus neutral (admiration, nostalgia, gratitude, disgust and so on). It was trained on 160,000 English sentences from Project Gutenberg that were labelled by an entailment model and then by pseudo-labelling, not by people (D3.5 pp. 16–18, 24). Italian, French and Dutch versions were trained on machine translations of those sentences (D3.5 pp. 17, 22).

The reported score is macro F1 0.59 on 727 sentences labelled by one person (the first author), taken from the same Gutenberg data and not from smell passages (D3.5 pp. 21–22, 25). The multilingual model scored 0.57 on English, 0.54 on Italian and French and 0.53 on Dutch (D3.5 p. 26, Table 12). No score is given for German or Slovenian.

Per-label precision on the gold set varies widely (D3.5 p. 25, Table 8, hard labels):

| Label | Precision | Recall |
|---|---|---|
| disgust | 0.84 | 0.38 |
| joy | 0.84 | 0.43 |
| desire | 0.82 | 0.79 |
| nostalgia | 0.29 | 0.97 |
| gratitude | 0.28 | 0.79 |
| grief | 0.27 | 0.86 |
| envy | 0.28 | 0.86 |

A hand-annotated benchmark with 12 emotion labels also exists for English, Italian, French and Dutch. Most of its cells hold fewer than 30 examples, the largest being 169 (English disgust), and it was not used for the graph labels (D3.5 pp. 13–14, Table 4).

Meaning for an answer: on the gold set about seven in ten nostalgia, gratitude, grief and envy predictions were wrong, so large counts for them include many false alarms. Say "tagged with", compare concepts rather than quoting totals, and be more careful still with German and Slovenian, which have no reported score.

## Images

Objects were found by a detector trained on the Odeuropa Dataset of Smell-Related Objects. Version 2 has 4,969 annotated artworks, 36,663 boxes and 170 categories (D2.4 p. 4). Annotators drew the boxes by hand in CVAT; flower species were also labelled by crowd workers on Mechanical Turk (D2.5 p. 9; D2.4 p. 4). Pre-annotating with a detector was planned and not used, because detection was not accurate enough (D2.4 p. 12).

Smell gestures are scarce in the training data (D2.4 p. 9, Table 4):

| Gesture | Examples |
|---|---|
| Holding the nose | 368 |
| Sniffing | 68 |
| Cleaning a baby | 10 |
| Vomiting | 5 |
| Defecating | 5 |

Detector accuracy is reported only for the ODOR challenge, which used 87 categories and a hidden test set (D2.5 pp. 5, 9, 13). The winning system reached COCO mAP 11.49 per cent (18.93 per cent at the looser IoU 0.5), the baseline 3.99 per cent. By object size the winner scored 4.19 per cent for small, 11.71 for medium and 25.24 for large boxes. It scored AP 0.44 for smoke and 0.33 for fire (D2.5 pp. 13–14). On one heap of fruit the winner matched 6 of 139 apples, no pears and no peaches, and it did not confuse the three fruits (D2.5 p. 14, Table 8). These are scores for the challenge, not for the detector behind the graph; the deliverables here give no precision for the graph's detector.

Meaning for an answer: a detector box is a candidate. Small objects, heaps and fruit varieties are the weakest. Look at the picture with `eokg_inspect_image` before stating what a painting shows, and do not count boxes as objects.

## Dates

The corpus metadata carries author, publication date and source (D3.2 p. 4). For Italian Project Gutenberg books the metadata date is that of the last publication, not the first (D3.2 p. 9). Dates parsed from Italian LiberLiber and Wikisource text were error-prone, with ranges such as "between 1628 and 1650" reduced to a midpoint (D3.4 p. 12); that describes the language-model training data, and the deliverables do not say it applies to the graph.

Time expressions annotated in the benchmark (for example "at first handling") were parsed with regular expressions, and durations and vague words such as "sometimes" were left open (D4.2 p. 10). The benchmark has only 49 to 131 Time annotations per language (D3.5 p. 8). No deliverable here says how the emission date of an extracted smell is set.

Meaning for an answer: date an event from the passage itself, and expect a document date to be a publication date that can fall long after first publication.
