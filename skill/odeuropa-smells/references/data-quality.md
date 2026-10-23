# Data quality: examples

**OCR in excerpts.** Expect `Â £` for a pound sign, `soaps , English` (spaces
before punctuation) and `fe - * melle` (hyphenation split). Quote as found and add
[sic]; do not repair.

**Emotions.** Rose smells are labelled "nostalgia" about 2,600 times and
"gratitude" about 2,400 times. These are classifier labels over a passage, so
describe them as "tagged with", never "the writer felt".

**Dates.** Timelines can contain -1000, 180, 2100 and 4830. A 1989 trade journal
sits in the corpus. About 540 Rose smells have no date. The document date
(source created) and the emission date (smell occurs) are different fields.

**Windowed search.** Rose, Italian, 1600–1800: a 1,000-hit window keeps 4 results,
5,000 keeps 9, 20,000 keeps 37. Using the Italian word (`rosa OR rose`) reaches
far more hits than filtering English-ranked ones.

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
