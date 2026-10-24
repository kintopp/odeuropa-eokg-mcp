# Vocabularies

The Skosmos service at vocab.odeuropa.eu serves 20 vocabularies. `eokg_find_concepts`
searches the first three by default; `vocab: "all"` adds the rest.

D4.3 (p. 8) and D4.6 (December 2023, p. 10) list 17 vocabularies; the three
`expert-taxonomy` vocabularies are the later additions, named in neither deliverable
(https://vocab.odeuropa.eu/rest/v1/vocabularies?lang=en).

| Vocabulary | What it is | Linked to smells |
|---|---|---|
| `olfactory-objects` | What smells: ~1,150 concepts (Flora, Body, Artefact, Matter, Food, Fumes, ...), multi-parent hierarchy, labels in de, en, fr, it, nl, sl | yes (smell sources; image sources) |
| `fragrant-spaces` | Where smells occur: Garden, Church, Kitchen, ... | yes (via the place of the smell) |
| `olfactory-gestures` | Gestures of smelling: holding one's nose, perfuming, ... | yes (via the smell experience; texts and images) |
| `expert-taxonomy`, `expert-taxonomy-chemical`, `expert-taxonomy-quality` | Expert classifications of smell sources, chemicals and qualities | no |
| `dhsv-sw`, `dravnieks`, `dravnieks-odorants`, `flavornet-odorants`, `flavornet-odors` | Sensory-science descriptor and odorant lists | no |
| `drom`, `noses`, `historic-book`, `historical-scent` | Perfumery and historical-scent reference lists | no |
| `edward_wheel`, `zwaardemaker`, `vdi-hedonic`, `vdi-intensity` | Odour classification systems and rating scales | no |
| `plutchik` | Emotion model behind the emotion labels | no |

How to use them:

- `olfactory-objects` and `olfactory-gestures` ids work with `eokg_smell_profile` and
  `eokg_find_visual_smells`; `fragrant-spaces` ids work with `eokg_smell_profile` only.
- A descriptive-vocabulary concept (e.g. the expert-taxonomy "rose") is useful for
  its labels and definitions, never for counts: nothing is linked to it.
- Iconclass notations are attached to some olfactory-objects and fragrant-spaces
  concepts from Odeuropa's curated tables (about 196 and 102 respectively). 52 of
  the olfactory-objects codes end in `(...)`.
