import { SsrfGuardError } from './error.js';

/**
 * Response size capping for the guarded fetches.
 *
 * A cap applied after `await res.text()` — which is what callers write
 * when the library gives them nothing — truncates a string that has
 * already crossed the wire in full. It is a display convenience, not a
 * control. `maxBytes` makes it a control: the transfer stops at the
 * limit and the read fails, so an endpoint that streams without end
 * cannot be used to exhaust the caller.
 *
 * Exceeding the cap is an error, never a silent truncation. A caller
 * handed a short body with no signal would treat a partial document as
 * the whole one, which is how a size limit turns into a correctness bug.
 */

/**
 * Validate a caller-supplied `maxBytes` up front, before any request is
 * made. A `NaN` from a bad `Number(process.env.X)` would otherwise
 * compare false against every size and silently disable the cap — a
 * security control that is off without saying so.
 */
export function normalizeMaxBytes(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`maxBytes must be a non-negative integer, received: ${String(value)}`);
  }
  return value;
}

function tooLarge(url: URL, maxBytes: number, actual: string): SsrfGuardError {
  return new SsrfGuardError(
    'blocked_response_size',
    `Response body exceeds maxBytes (${maxBytes}): ${actual}`,
    {
      scheme: url.protocol.replace(/:$/, ''),
      host: url.hostname,
      url: url.toString(),
    },
  );
}

/**
 * Enforce `maxBytes` on a response, in two places because either alone
 * is insufficient: `Content-Length` lets an oversized body be rejected
 * before a single byte is read, and the streaming count catches the
 * bodies that omit or understate it.
 *
 * Returns a `Response` whose body is the capped stream. Note this is a
 * NEW `Response` object, so `url`, `redirected`, and `type` are not
 * carried over — use `onFinalUrl` for the final URL, which is more
 * reliable than `Response.url` anyway.
 */
export async function capResponseBody(
  response: Response,
  maxBytes: number,
  url: URL,
): Promise<Response> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      // Release the connection rather than leaving the body dangling.
      await response.body?.cancel().catch(() => {});
      throw tooLarge(url, maxBytes, `content-length ${length}`);
    }
  }

  const body = response.body;
  // 204/304 and HEAD responses have no body to cap, and reconstructing
  // a Response for a null-body status would throw.
  if (!body) return response;

  let seen = 0;
  const capped = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          // Errors the readable side, so the caller's `.text()`/`.json()`
          // rejects, and cancels the source so the transfer stops here.
          controller.error(tooLarge(url, maxBytes, `read ${seen} bytes`));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  return new Response(capped, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
