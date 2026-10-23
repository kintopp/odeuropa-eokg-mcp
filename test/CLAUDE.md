# Test rules

- One live gate: `export const LIVE = process.env.EOKG_LIVE === '1'`. Use exact equality, never truthiness.
- `npm test` is offline. A test that reaches the real network without `{ skip: !LIVE }` is a bug.
  The stub backend fails loudly on any unrouted request.
- Model-facing wording (descriptions, warnings, instructions) is behaviour, so assert key phrases.
- Prove each new assertion can fail: break the code briefly, watch the test go red, then restore it.
- Every SPARQL query carries a unique `eokg:<name>` label; the stub router routes on it.
