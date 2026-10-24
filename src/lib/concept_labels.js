// Prefix labels of concept URIs, grouped as pickLabel input.

import { sparqlSelect, v, lang as langOf } from '../sparql/client.js';
import { conceptLabelsQuery } from '../sparql/queries/concept.js';

/** Map of concept URI to its `[{ value, 'xml:lang' }]` labels, from one `concept_labels` query. */
export async function fetchConceptTerms(uris, signal) {
  const terms = new Map();
  if (!uris.length) return terms;
  const rows = await sparqlSelect('concept_labels', conceptLabelsQuery(uris), { signal });
  for (const r of rows) {
    const uri = v(r, 'c');
    if (!terms.has(uri)) terms.set(uri, []);
    terms.get(uri).push({ value: v(r, 'l'), 'xml:lang': langOf(r, 'l') });
  }
  return terms;
}
