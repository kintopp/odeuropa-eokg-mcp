// Bridges node:http to the web-standard Request/Response the MCP handler speaks.

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Resolves the body, or rejects with err.status = 413 once it exceeds `max` bytes.
export function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error('Request body too large'), { status: 413 });
    if (Number(req.headers['content-length']) > max) {
      req.resume();
      reject(tooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > max) {
        failed = true;
        chunks.length = 0;
        reject(tooLarge());
        return; // keep draining so the client can finish sending and read the 413
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

export function toWebRequest(req, body, signal) {
  const forwarded = req.headers['x-forwarded-proto']?.split(',')[0].trim();
  const proto = forwarded === 'https' ? 'https' : 'http';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (key === 'content-length') continue; // describes the raw stream, not `body`
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  return new Request(`${proto}://${req.headers.host ?? 'localhost'}${req.url}`, {
    method: req.method,
    headers,
    signal,
    ...(req.method === 'POST' && { body }),
  });
}

// Headers go out immediately (flushHeaders), so an SSE answer is already committed
// while the tool runs. Writes nothing once the response has been ended or destroyed.
export async function writeWebResponse(res, response) {
  if (res.destroyed || res.writableEnded) {
    await response.body?.cancel().catch(() => {});
    return;
  }
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== 'content-length') res.setHeader(key, value);
  });
  res.setHeader('X-Accel-Buffering', 'no');
  if (!response.body) {
    res.end();
    return;
  }
  res.flushHeaders();
  await pipeline(Readable.fromWeb(response.body), res);
}
