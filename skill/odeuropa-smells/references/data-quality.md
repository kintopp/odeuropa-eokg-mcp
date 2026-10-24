# Data quality: examples

**OCR in excerpts.** Expect `Â £` for a pound sign, `soaps , English` (spaces
before punctuation) and `fe - * melle` (hyphenation split). Quote as found and add
[sic]; do not repair.

**Emotions.** Rose smells are labelled "nostalgia" about 2,600 times and
"gratitude" about 2,400 times. These are classifier labels over a passage, so
describe them as "tagged with", never "the writer felt".

**Dates.** Timelines can contain -1000, 180, 2100 and 4830. A 1989 trade journal
sits in the corpus. About 540 Rose smells have no date. The document date
(source created) and the emission date (smell occurs) are different fields, but only
10 of 8,393 dated Tobacco smells differ, so `emission_timeline` rarely adds anything.
Some Old Bailey sessions have no date field and carry the date only in their long
title; `XXXX-09-08` counts as undated.

**Windowed search.** Rose, Italian, 1600–1800: a 1,000-hit window keeps 4 results,
5,000 keeps 9, 20,000 keeps 37. Using the Italian word (`rosa OR rose`) reaches
far more hits than filtering English-ranked ones.

**OR and accents.** `tobacco and smoke` gives 1,254,625 hits, `tobacco AND smoke` 3,478.
`égouts` gives 594 hits, `egouts` 22. `fmell` alone gives 36,672: OCR reads the long s as f.

**Language coverage.** Rose has 0 German smells and Tobacco 2; Flower with narrower
concepts has 142 German smells of 168,243. Profile counts for German undercount the
text; full-text search does not.

**Same passage, several datasets.** Kostanjevec's *Noč* (1902) appears in `dlib`, in
*Ljubljanski zvon* and in `text-annotation`, each copy with different roles. Three
results are one passage.

**Raw strings.** Top Rose places: "jardin" (84), "chambre" (62), "in" (22). Top
carriers are mostly "the", "it", "they". Qualities mix languages ("fragrant",
"aromatique").

**Iconclass.** The KG's own `skos:closeMatch` values are single characters. The
curated code for Rose is `25G41(...)`; the specific candidate `25G41(ROSE)` is
valid in Iconclass but must be verified before use. Lavender's `31A5141(...)`
("scents with NAME") has no named children.

**Image boxes.** Detector boxes average about 0.76 confidence; boxes scoring 1.0 are
manual. The hosted picture is a reduced copy (often 650 px), and box coordinates
refer to that copy.
