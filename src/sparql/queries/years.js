// Year-range FILTER bounds on a gYear variable. Years are zod-validated integers.

const pad4 = (y) => String(y).padStart(4, '0');

/** `?x >= "…"^^xsd:gYear && ?x <= "…"^^xsd:gYear`, either side optional; '' when neither is set. */
export const yearBounds = (variable, yearFrom, yearTo) => [
  yearFrom != null && `${variable} >= "${pad4(yearFrom)}"^^xsd:gYear`,
  yearTo != null && `${variable} <= "${pad4(yearTo)}"^^xsd:gYear`,
].filter(Boolean).join(' && ');
