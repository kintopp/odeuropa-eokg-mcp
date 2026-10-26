# What the Knowledge Graph Adds

The European Olfactory Knowledge Graph holds about 2.4 million smell references taken from European texts and images. This page describes questions that a full-text index of this data answers only partially or not at all, and which tools this MCP server uses to answer them with the knowledge graph. The example prompts below can be pasted into a chat session with the server connected. Please also enable the server's [skill file](../README.md#skill) – this will help an AI assistant select the best approach for each query.

- [Smells as Events in a Graph](#smells-as-events-in-a-graph)
- [Concepts Instead of Words](#concepts-instead-of-words)
- [Roles in a Smell](#roles-in-a-smell)
- [Broader and Narrower Concepts](#broader-and-narrower-concepts)
- [Texts and Images Together](#texts-and-images-together)
- [Links to Iconclass](#links-to-iconclass)
- [From One Passage to Its Source](#from-one-passage-to-its-source)
- [Limits](#limits)

## Smells as Events in a Graph

In the graph a smell event is a record of its own, separate from the passage it was found in. The extraction pipelines read a sentence such as "the sweet smell of incense filled the church" and create one smell event with named parts: incense is the *smell source*, the church is the *fragrant space*, and "sweet" becomes a *quality*. Other components can include the *carrier*, the time, the *place*, the *person* who smelled it and an *emotion*. Each of these components is a different perspective on the same smell event.

In contrast, a full-text index stores the sentence as a string of words. It can find "incense" and "church" near each other, but it cannot tell which one *smelled* and which one was the *setting*. All of the examples below draw on this distinction.

## Concepts Instead of Words

Each smell source is linked to a concept in the Odeuropa vocabularies, and also to the words the text actually used. The concept has a single identifier and labels in six languages. Coffee (`olfactory-objects/50`), for example, is labelled Café, Caffé, Koffie, Kava and Kaffee.

*How did references to tobacco change between 1600 and 1900, and in which languages?*

- `eokg_find_concepts` with `query: "tobacco"` returns Tobacco (`olfactory-objects/227`).
- `eokg_smell_profile` on that concept counts every smell linked to it, with a timeline, a breakdown by language and the qualities attached to it. On 24 October 2026 the total was 8,460 smells.

The count includes passages that say *tabac*, *tabacco* or *Tabak*, passages with OCR damage the extractor still resolved, and passages that refer to tobacco without using the word. A keyword search would need every spelling in every language and would still miss the last two groups.

## Roles in a Smell

Because the parts of a smell are named, you can ask about one part in relation to another.

*Which smell sources are mentioned in churches?*

- `eokg_find_concepts` finds the fragrant space Church.
- `eokg_smell_profile` on it, with the `smell_sources` facet, lists the sources extracted from the same smell events. These are smells that were located in a church, not words that happen to appear near "church" on the page.

*What qualities are attached to the smell of tar?*

- The `qualities` facet of `eokg_smell_profile` counts the qualities linked to smells of tar. A quality that describes a different smell in the same paragraph is not counted.

## Broader and Narrower Concepts

The vocabularies are hierarchies: Rose and Violet sit under Flower, for example.

*Which flowers are mentioned most often, and how does that change over time?*

- `eokg_get_concept` on Flower lists its narrower concepts.
- `eokg_smell_profile` on each of them gives comparable counts. With `include_narrower: true` the profile of Flower covers all of them at once. This is slower, at 15 to 30 seconds per facet.

No keyword finds "any flower".

## Texts and Images Together

Text smells and image annotations are linked to the same concepts. A painting in which the object detector found a pipe and a passage that describes pipe smoke both point to Tobacco. Gestures such as holding one's nose are linked in the same way: through the smell experience in texts and through the annotated object in images.

*Find paintings that show someone holding their nose, and texts from the same period that describe the gesture.*

- `eokg_find_concepts` finds the gesture (`olfactory-gestures/2`).
- `eokg_find_visual_smells` on it lists the paintings and prints, and `eokg_view_image` shows one to the user.
- `eokg_smell_profile` on the same concept shows how many of its smells come from texts and how many from images, in which periods, and in which datasets.

A text index contains no images, and an image catalogue contains no excerpts. In the graph both lead to the same concept.

## Links to Iconclass

Odeuropa's curated tables link vocabulary concepts to Iconclass notations.

*Which EOKG artworks show the subject of Iconclass 31A33 (smelling)?*

- `eokg_find_concepts` accepts an Iconclass notation and returns the matching Odeuropa concepts, which then go to `eokg_find_visual_smells`.
- In the other direction, the notation on a concept can be passed to an Iconclass server or to a museum collection that is indexed with Iconclass, to find more works on the same subject.

## From One Passage to Its Source

Each smell is linked to the document or image it was taken from, and the document is linked to all the smells extracted from it.

*For this passage, show me the whole book and every other smell found in it.*

- `eokg_get_smell` returns the passage and its parts.
- `eokg_get_source` returns the document with a page of its smells. This gives the olfactory content of a whole book or painting, not only the passages that matched a search term.

A good way to work is to combine the two approaches. Find a passage by keyword with `eokg_search_smells`, read its concept from `eokg_get_smell`, then profile that concept with `eokg_smell_profile`.

## Limits

- **Every count starts from a concept.** The public endpoint stops queries after 60 seconds, and questions that cover the whole graph, such as "what was the most-mentioned smell in 1750?", take longer than that. The server does not offer them.
- **The structure was extracted by machine.** Roles, concepts and qualities come from automatic pipelines and contain errors. Read the passages before relying on a count.
- **Emotions are a weak signal.** They come from a classifier, not from the text. The classifier was not run on some datasets and has no model for German or Slovenian.
- **Counts compare concepts.** The corpus grows steeply after 1800, so the timeline of one concept mostly reflects the size of the corpus. Compare a concept with other concepts in the same period.
- **Links to Wikidata are not followed.** The graph links some concepts to Wikidata, but the server drops those links and does not query Wikidata.
