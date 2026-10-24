// Queries for eokg_get_source and eokg_inspect_image. Each takes a canonical source URI already validated by parseId.

import { OLFACTORY_OBJECTS_GRAPH } from '../../config.js';

export const sourceMetaQuery = (src) => `
SELECT ?type ?title ?url ?lang ?date ?begin ?author ?artist ?license ?genre ?image ?place FROM onto:explicit WHERE {
  VALUES ?s { <${src}> } ?s a ?type . FILTER(?type IN (crm:E33_Linguistic_Object, crm:E36_Visual_Item))
  OPTIONAL { ?s rdfs:label ?title } OPTIONAL { ?s schema:url ?url } OPTIONAL { ?s schema:inLanguage ?lang }
  OPTIONAL { ?s schema:dateCreated ?t . OPTIONAL { ?t rdfs:label ?date } OPTIONAL { ?t time:hasBeginning ?begin } }
  OPTIONAL { ?s schema:author/rdfs:label ?author } OPTIONAL { ?s schema:artist/rdfs:label ?artist }
  OPTIONAL { ?s schema:license ?license } OPTIONAL { ?s schema:genre/rdfs:label ?genre }
  OPTIONAL { ?s schema:image ?image } OPTIONAL { ?s schema:locationCreated/rdfs:label ?place }
}`;

export const sourceSmellCountQuery = (src) => `
SELECT (COUNT(DISTINCT ?smell) AS ?n) WHERE { <${src}> crm:P67_refers_to ?smell . ?smell a od:L11_Smell }`;

export const sourceSmellPageQuery = (src, limit, offset) => `
SELECT ?smell (SAMPLE(?txt) AS ?excerpt) (GROUP_CONCAT(DISTINCT ?cl; separator="|") AS ?concepts) WHERE {
  { SELECT ?smell WHERE { <${src}> crm:P67_refers_to ?smell . ?smell a od:L11_Smell } ORDER BY ?smell LIMIT ${limit} OFFSET ${offset} }
  OPTIONAL { ?em od:F1_generated ?smell ; od:F3_had_source ?c . GRAPH <${OLFACTORY_OBJECTS_GRAPH}> { ?c skos:prefLabel ?cl FILTER(LANG(?cl) = "en") } }
  OPTIONAL { ?frag crm:P67_refers_to ?smell ; rdf:value ?txt }
} GROUP BY ?smell ORDER BY ?smell`;

export const imageFragmentsQuery = (src) => `
SELECT ?f ?body ?label ?score ?x ?y ?w ?h ?prov FROM onto:explicit WHERE {
  <${src}> ma:hasFragment ?f . ?f oa:hasBody ?body ; rdf:value ?score ; nsa:spatialX ?x ; nsa:spatialY ?y ; nsa:spatialW ?w ; nsa:spatialH ?h .
  OPTIONAL { ?f <http://www.w3.org/ns/prov#wasGeneratedBy> ?prov }
  OPTIONAL { GRAPH <${OLFACTORY_OBJECTS_GRAPH}> { ?body skos:prefLabel ?label FILTER(LANG(?label) = "en") } }
} ORDER BY DESC(?score) ?f`;

export const smellSourceQuery = (smell) => `
SELECT ?source WHERE {
  ?source crm:P67_refers_to <${smell}> ; a ?t . FILTER(?t IN (crm:E33_Linguistic_Object, crm:E36_Visual_Item))
} LIMIT 1`;

export const sourceExistsQuery = (src) => `
SELECT ?t WHERE { <${src}> a ?t . FILTER(?t IN (crm:E33_Linguistic_Object, crm:E36_Visual_Item)) } LIMIT 1`;
