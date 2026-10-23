# Test rules

Extends the root `CLAUDE.md`: the offline suite is the only continuous layer, so never delete or weaken a failing test.

## Writing a test

- **List how the unit could fail before writing it**, ideally as `test.todo` entries. A test written by reading the
  finished code just restates it.
- **Prove each new assertion can fail:** break the code it guards, watch it go red, restore.
- **Never derive an expected value from the code under test.** Don't import a config constant to build the expectation
  (e.g. `PROFILE_DEFAULT_FACETS`); spell out the values the spec requires, or assert the invariant the constant must satisfy.
  Comparing two calls is fine when equality *is* the property (cache hits, deterministic builds).
- **A test that breaks under a behaviour-preserving refactor asserts implementation.** Don't add it: internal names, call
  order, or an exact count where an upper bound states the real constraint.
- **Model-facing wording is behaviour** (descriptions, warnings, error suggestions, instructions). Assert key phrases, and
  don't loosen them under the refactor rule.
- **Test at the highest offline boundary that pins the behaviour.** For a tool that is the handler against the stub
  backend: input in, `structuredContent` out, checked with `assertWireValid`. Don't duplicate a stronger test one level down.
- **No test-only exports.** Test through the exported function that uses the helper.

## Query-text assertions

String checks on SPARQL are justified here, because a wrong query shape passes offline and fails only live: an unanchored
aggregate hits the 60 s gateway, a filter after `LIMIT` lets twins take top-N slots. Each such assertion names the invariant
it guards. Order checks assert presence too: `indexOf(a) >= 0 && indexOf(a) < indexOf(b)`; a bare `<` passes when `a` is missing.

## Harness

- One live gate: `export const LIVE = process.env.EOKG_LIVE === '1'`. Exact equality, never truthiness. `npm test` is
  offline; a test that reaches the network without `{ skip: !LIVE }` is a bug.
- `test/stub-backend.js`: one routing table behind two transports. `installFetchStub` for in-process tests,
  `startStubServer` (with `EOKG_SPARQL_ENDPOINT` in the child's env) for subprocess tests via `withClient`. Routes key on the
  `eokg:<name>` label; unrouted requests fail loudly. Don't hand-roll `fetch` mocks.
- Image fetches: `IMAGE_URL_RE` is a security boundary and never gets an env override, so image tests run in-process
  (`InMemoryTransport` + `createServer()` + a fetch wrapper), as in `inspect_image.test.js`.
- Time: stub `Date.now` with `mock.method` and let a stub route advance the fake clock (`smell_profile.test.js`). Don't add
  a config knob for tests.
- Call `clearSparqlCache()` / `clearImageCache()` between tests that reuse a query.
- Live tests run sequentially and never retry a 504: the gateway's 60 s cut repeats, and each retry costs another minute.
