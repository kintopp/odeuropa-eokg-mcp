// Queries for eokg_get_concept and eokg_find_concepts. Concept URIs are already validated by parseId.

// No skos:closeMatch: the KG's Iconclass matches are corrupt (one character each); iconclass comes from src/data/iconclass.json.
export const conceptDetailQuery = (c) => `
SELECT ?g ?p ?o ?olabel WHERE { GRAPH ?g { <${c}> ?p ?o .
  FILTER(?p IN (skos:prefLabel, skos:altLabel, skos:definition, skos:scopeNote, skos:broader, skos:related, skos:inScheme, schema:image))
  OPTIONAL { ?o skos:prefLabel ?olabel } } }`;

export const conceptNarrowerQuery = (c, max) => `
SELECT DISTINCT ?n ?l WHERE { { ?n skos:broader <${c}> } UNION { <${c}> skos:narrower ?n }
  OPTIONAL { ?n skos:prefLabel ?l } } LIMIT ${max * 8}`;

// Only for linked schemes. Each count is anchored (smells 0.6 s for Rose, images 50 ms, places 0.2 s for Garden),
// and each has the dataset clause it was measured with.
export const conceptSmellCountQuery = (c) => `
SELECT (COUNT(DISTINCT ?smell) AS ?smells) WHERE { ?em od:F3_had_source <${c}> ; od:F1_generated ?smell }`;

export const conceptImageCountQuery = (c) => `
SELECT (COUNT(DISTINCT ?s) AS ?images) FROM onto:explicit WHERE { ?s crm:P138_represents <${c}> }`;

export const spaceSmellCountQuery = (c) => `
SELECT (COUNT(DISTINCT ?smell) AS ?smells) WHERE { ?place crm:P137_exemplifies <${c}> . ?em crm:P7_took_place_at ?place ; od:F1_generated ?smell }`;

export const conceptLabelsQuery = (uris) => `
SELECT ?c ?l FROM onto:explicit WHERE { VALUES ?c { ${uris.map((u) => `<${u}>`).join(' ')} } ?c skos:prefLabel ?l }`;

export const gestureSmellCountQuery = (c) => `
SELECT (COUNT(DISTINCT ?smell) AS ?smells) WHERE { ?ex od:F5_involved_gesture <${c}> ; od:F2_perceived ?smell }`;
