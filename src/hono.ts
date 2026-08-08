import { UrlPolicy } from './policy.js';
import { guardToolInput } from './tool-input.js';
import type { UrlPolicyOptions } from './types.js';

/**
 * Hono middleware — the Workers-native counterpart to
 * `createExpressUrlGuard`. Scans a request for URLs that the policy
 * rejects and answers with a structured error instead of letting the
 * handler fetch them.
 *
 * Shipped as a separate entry point (`@devslab/ssrf-guard-js/hono`) so
 * nothing here lands in the root bundle, and typed structurally against
 * the shape of a Hono context rather than importing Hono — the package
 * stays dependency-free, and any framework with the same shape works.
 *
 * ```ts
 * import { Hono } from 'hono';
 * import { createHonoUrlGuard } from '@devslab/ssrf-guard-js/hono';
 *
 * const app = new Hono();
 * app.post('/crawl', createHonoUrlGuard({ suffixes: ['example.com'] }), async (c) => {
 *   const { url } = await c.req.json();  // already validated
 *   ...
 * });
 * ```
 */

export interface MinimalHonoRequest {
  query(): Record<string, string>;
  param(): Record<string, string>;
  header(name: string): string | undefined;
  json(): Promise<unknown>;
  parseBody(): Promise<unknown>;
}

export interface MinimalHonoContext {
  req: MinimalHonoRequest;
  json(body: unknown, status?: number): Response;
}

export type MinimalHonoNext = () => Promise<void>;

export interface HonoGuardOptions {
  /** Scan the request body. Default `true`. See the parsing note below. */
  body?: boolean;
  /** Scan query parameters. Default `true`. */
  query?: boolean;
  /** Scan path parameters. Default `false`. */
  params?: boolean;
  /** Status for a blocked request. Default `400`. */
  statusCode?: number;
}

/**
 * Which bodies get scanned, stated plainly because a guard with a silent
 * gap is worse than one with a known one:
 *
 * - `application/json` (and `+json`) — parsed with `c.req.json()`
 * - `application/x-www-form-urlencoded` — parsed with `c.req.parseBody()`
 * - **anything else, including `multipart/form-data`, is NOT scanned**
 *
 * Multipart is excluded deliberately: parsing it here would buffer
 * uploaded files inside a guard that runs on every request, turning a
 * safety check into a memory cost. Route file uploads past this
 * middleware, or validate their URL fields in the handler.
 *
 * Hono caches parsed bodies, so reading the body here does not consume it
 * — the handler's own `c.req.json()` still resolves.
 */
function shouldScanBody(contentType: string | undefined): 'json' | 'form' | null {
  if (!contentType) return null;
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type === 'application/x-www-form-urlencoded') return 'form';
  return null;
}

export function createHonoUrlGuard(
  policy: UrlPolicyOptions | UrlPolicy,
  options: HonoGuardOptions = {},
): (c: MinimalHonoContext, next: MinimalHonoNext) => Promise<Response | void> {
  const scanBody = options.body ?? true;
  const scanQuery = options.query ?? true;
  const scanParams = options.params ?? false;
  const statusCode = options.statusCode ?? 400;
  // Built once rather than per request: a UrlPolicy normalizes its host
  // lists and scheme/port sets in the constructor.
  const urlPolicy = policy instanceof UrlPolicy ? policy : new UrlPolicy(policy);

  return async (c, next) => {
    const candidates: unknown[] = [];
    if (scanQuery) candidates.push(c.req.query());
    if (scanParams) candidates.push(c.req.param());

    if (scanBody) {
      const kind = shouldScanBody(c.req.header('content-type'));
      if (kind) {
        try {
          candidates.push(kind === 'json' ? await c.req.json() : await c.req.parseBody());
        } catch {
          // A body that does not parse cannot contain a URL we could
          // validate. Leave it to the handler, which owns the contract
          // and will reject it with a message that fits the route.
        }
      }
    }

    for (const candidate of candidates) {
      const violation = guardToolInput(candidate, urlPolicy);
      if (violation) return c.json(JSON.parse(violation), statusCode);
    }

    await next();
  };
}
