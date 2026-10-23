// Queries for eokg_get_smell. Each takes a canonical smell URI already validated by parseId.

import { SMELL_MAX_EXCERPTS } from '../../config.js';

export const smellCoreQuery = (id) => `
SELECT ?graph ?source ?type ?title ?url ?lang ?date ?license ?genre ?author ?artist ?image WHERE {
  VALUES ?id { <${id}> }
  GRAPH ?graph { ?id a od:L11_Smell }
  ?source crm:P67_refers_to ?id ; a ?type . FILTER NOT EXISTS { ?source rdf:value [] }
  FILTER(?type IN (crm:E33_Linguistic_Object, crm:E36_Visual_Item))
  OPTIONAL { ?source rdfs:label ?title } OPTIONAL { ?source schema:url ?url }
  OPTIONAL { ?source schema:inLanguage ?lang } OPTIONAL { ?source schema:dateCreated/rdfs:label ?date }
  OPTIONAL { ?source schema:license ?license } OPTIONAL { ?source schema:genre/rdfs:label ?genre }
  OPTIONAL { ?source schema:author/rdfs:label ?author } OPTIONAL { ?source schema:artist/rdfs:label ?artist }
  OPTIONAL { ?source schema:image ?image }
}`;

export const smellExcerptsQuery = (id) => `
SELECT DISTINCT ?frag ?text WHERE { VALUES ?id { <${id}> } ?frag crm:P67_refers_to ?id ; rdf:value ?text . }
ORDER BY ?frag LIMIT ${SMELL_MAX_EXCERPTS + 1}`;

export const smellRolesQuery = (id) => `
SELECT ?role ?val ?valLabel WHERE {
  VALUES ?id { <${id}> }
  { ?em od:F1_generated ?id ; od:F3_had_source ?val . BIND("source" AS ?role) OPTIONAL { ?val skos:prefLabel ?valLabel } OPTIONAL { ?val rdfs:label ?valLabel } }
  UNION { ?em od:F1_generated ?id ; od:F4_had_carrier ?val . BIND("carrier" AS ?role) OPTIONAL { ?val rdfs:label ?valLabel } }
  UNION { ?em od:F1_generated ?id ; time:hasTime ?val . BIND("time" AS ?role) OPTIONAL { ?val rdfs:label ?valLabel } }
  UNION { ?ex od:F2_perceived ?id ; crm:P7_took_place_at ?val . BIND("place" AS ?role) OPTIONAL { ?val rdfs:label ?valLabel } }
  UNION { ?ex od:F2_perceived ?id ; od:F5_involved_perceiver ?val . BIND("perceiver" AS ?role) OPTIONAL { ?val rdfs:label ?valLabel } }
  UNION { ?ex od:F2_perceived ?id . ?val reo:readP27 ?ex . BIND("emotion" AS ?role) OPTIONAL { ?val rdfs:label ?valLabel } }
  UNION { ?a crm:P140_assigned_attribute_to ?id ; crm:P141_assigned ?val . BIND("quality" AS ?role) OPTIONAL { ?val skos:prefLabel ?valLabel } OPTIONAL { ?val rdfs:label ?valLabel } }
}`;
