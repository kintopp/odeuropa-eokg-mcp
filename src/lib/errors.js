// Tool-side error type. Anything an LLM could self-correct from (bad input, a
// query the backend rejected) should surface as a tool result with isError:true
// and actionable text — not a thrown JSON-RPC protocol error.

export class ToolError extends Error {
  constructor(message, suggestion) {
    super(message);
    this.name = 'ToolError';
    this.suggestion = suggestion;
  }
}

export function assertYearRange(yearFrom, yearTo) {
  if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
    throw new ToolError('`year_from` is later than `year_to`.', 'Swap them or widen the range.');
  }
}

// Normalize any thrown value into user/LLM-facing text.
export function formatErrorText(err) {
  if (err instanceof ToolError) {
    return err.suggestion ? `${err.message} — ${err.suggestion}` : err.message;
  }
  if (err && typeof err === 'object' && 'message' in err) return String(err.message);
  return String(err);
}
