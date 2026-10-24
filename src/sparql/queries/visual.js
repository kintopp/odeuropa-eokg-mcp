// Queries for eokg_find_visual_smells. `c` is a parseId-validated concept URI; years are pre-validated integers; `minScore` is a zod-validated number in 0–1.

const pad4 = (y) => String(y).padStart(4, '0');

// Undated images are excluded when a year filter is given, so the count and the page agree.
export function dateFilter(v, yearFrom, yearTo) {
  const bounds = [
    yearFrom != null && `?vb >= "${pad4(yearFrom)}"^^xsd:gYear`,
    yearTo != null && `?vb <= "${pad4(yearTo)}"^^xsd:gYear`,
  ].filter(Boolean).join(' && ');
  return bounds ? `${v} schema:dateCreated/time:hasBeginning ?vb . FILTER(${bounds})` : '';
}

const IMAGE_FILTER = 'FILTER(STRSTARTS(STR(?img), "https://data.odeuropa.eu/image/"))';

// An image is hidden when its best box scores below minScore; the ranking sorts by that score, so hidden images are its tail.
export const visualCountQuery = (c, { yearFrom, yearTo }, minScore) => `
SELECT (COUNT(?source) AS ?n) (SUM(IF(BOUND(?best) && ?best < ${minScore}, 1, 0)) AS ?hidden) FROM onto:explicit WHERE {
  { SELECT ?source (MAX(?score) AS ?best) WHERE {
    ?source crm:P138_represents <${c}> ; schema:image ?img . ${IMAGE_FILTER}
    ${dateFilter('?source', yearFrom, yearTo)}
    OPTIONAL { ?source ma:hasFragment ?f . ?f oa:hasBody <${c}> ; rdf:value ?score }
  } GROUP BY ?source } }`;

export const visualPageQuery = (c, { yearFrom, yearTo }, minScore, limit, offset) => `
SELECT ?source (SAMPLE(?t) AS ?title) (SAMPLE(?img) AS ?image) (SAMPLE(?d) AS ?date) (SAMPLE(?a) AS ?artist)
       (MAX(?score) AS ?best) (COUNT(DISTINCT ?kf) AS ?boxes) FROM onto:explicit WHERE {
  ?source crm:P138_represents <${c}> ; schema:image ?img . ${IMAGE_FILTER}
  ${dateFilter('?source', yearFrom, yearTo)}
  OPTIONAL { ?source rdfs:label ?t } OPTIONAL { ?source schema:dateCreated/rdfs:label ?d } OPTIONAL { ?source schema:artist/rdfs:label ?a }
  OPTIONAL { ?source ma:hasFragment ?f . ?f oa:hasBody <${c}> ; rdf:value ?score }
  BIND(IF(?score >= ${minScore}, ?f, ?unset) AS ?kf)
} GROUP BY ?source HAVING(!BOUND(?best) || ?best >= ${minScore}) ORDER BY DESC(?best) ?source LIMIT ${limit + 1} OFFSET ${offset}`;
