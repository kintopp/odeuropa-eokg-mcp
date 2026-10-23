// `notifications/progress` for the page-scanning tools. Throttled because a scan
// settles up to OCR_PAGE_CONCURRENCY pages at once over as many as
// MAX_LOCATE_MAX_PAGES; never awaited, so a lost notification can't stall a call.

import { PROGRESS_MIN_INTERVAL_MS } from '../config.js';

const noop = () => {};

export const progressTokenOf = (ctx) => ctx?.mcpReq?._meta?.progressToken;

// Returns `report(progress, total?, message?)`, a no-op unless the client sent a
// progressToken. The spec requires `progress` to increase on every notification.
export function progressReporter(ctx, { now = Date.now } = {}) {
  const progressToken = progressTokenOf(ctx);
  if (progressToken == null) return noop;

  let lastAt = -Infinity;
  let lastProgress = 0;
  return (progress, total, message) => {
    const at = now();
    if (progress <= lastProgress || at - lastAt < PROGRESS_MIN_INTERVAL_MS) return;
    lastAt = at;
    lastProgress = progress;
    const params = { progressToken, progress, ...(total != null && { total }), ...(message && { message }) };
    ctx.mcpReq.notify({ method: 'notifications/progress', params }).catch(noop);
  };
}
