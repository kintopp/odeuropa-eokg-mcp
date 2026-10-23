// Shared fixtures for the source/image tests (live probe P3b of the RKD still life).

const KG = 'http://data.odeuropa.eu/';
export const uri = (value) => ({ type: 'uri', value });
export const IMAGE_SOURCE = `${KG}source/00721405-98be-5795-ac1d-3510448af60a`;
export const DETECTOR = `${KG}provenance/db29c010-6542-531f-aea4-8d066a16ad70`;
export const MANUAL = `${KG}provenance/9353c0bc-1e0b-5a83-9ec3-24b82faf8a56`;

const OBJ = `${KG}vocabulary/olfactory-objects/`;
const row = (body, label, score, x, y, w, h) => ({
  f: uri(`${IMAGE_SOURCE}#xywh=${x},${y},${w},${h}`), body: uri(`${OBJ}${body}`),
  label: { type: 'literal', value: label, 'xml:lang': 'en' },
  score: { type: 'literal', value: String(score), datatype: 'http://www.w3.org/2001/XMLSchema#decimal' },
  x: String(x), y: String(y), w: String(w), h: String(h), prov: uri(DETECTOR),
});

export const FRAGMENT_ROWS = [
  row(335, 'Lemon', 0.949241042137146, 313, 445, 88, 56),
  row(285, 'Peach', 0.9479654431343079, 206, 417, 77, 78),
  row(287, 'Grape', 0.9433900117874146, 219, 183, 104, 129),
  row(450, 'Glass with stem', 0.939185619354248, 323, 303, 85, 146),
  row(285, 'Peach', 0.9311192631721497, 293, 233, 54, 56),
  row(287, 'Grape', 0.9253435730934143, 138, 378, 102, 120),
];
