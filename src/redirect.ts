import { SsrfGuardError } from './error.js';
import { UrlPolicy, validateUrl } from './policy.js';

/**
 * The shared redirect-revalidation loop behind `safeFetch` (Node, adds
 * DNS checks via hooks) and `guardedFetch` (any runtime, URL-time
 * checks only). Kept free of Node imports so the guarded-fetch module
 * graph loads on Workers/browsers/Deno.
 *
 * Semantics ported from the fetch spec and the Java adapters:
 * every hop re-passes the policy before it is followed; `303` (and
 * `301`/`302` for `POST`) downgrade to `GET` without replaying the
 * body; credentials are stripped when a redirect changes origin.
 */

export type FetchImpl = (
  url: URL,
  init: RequestInit & Record<string, unknown>,
) => Promise<Response>;

const SENSITIVE_HEADERS = ['authorization', 'proxy-authorization', 'cookie'];

export interface RedirectLoopArgs {
  url: URL;
  policy: UrlPolicy;
  init: RequestInit;
  maxRedirects: number;
  fetchImpl: FetchImpl;
  /** Runs before each hop's fetch — safeFetch's unpinned DNS check. */
  beforeHop?: (url: URL) => Promise<void>;
  /** Unwrap fetch errors — safeFetch's pinned-lookup guard-error unwrap. */
  mapFetchError?: (error: unknown) => unknown;
  /** Extra init merged into every hop's request (undici dispatcher). */
  extraInit?: Record<string, unknown>;
  /** Called with the final validated URL when a response is returned. */
  onFinalUrl?: (url: URL) => void;
}

export async function followRedirectsGuarded(args: RedirectLoopArgs): Promise<Response> {
  const { policy, maxRedirects, fetchImpl, beforeHop, mapFetchError, extraInit, onFinalUrl } = args;
  const requestInit = args.init;
  const headers = new Headers(requestInit.headers);
  let url = args.url;
  let method = (requestInit.method ?? 'GET').toUpperCase();
  let body = requestInit.body ?? null;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    if (beforeHop) await beforeHop(url);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...requestInit,
        method,
        body,
        headers,
        redirect: 'manual',
        ...(extraInit ?? {}),
      });
    } catch (error) {
      throw mapFetchError ? mapFetchError(error) : error;
    }

    if (!isRedirect(response.status)) {
      onFinalUrl?.(url);
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      onFinalUrl?.(url);
      return response;
    }

    await response.body?.cancel();

    const nextUrl = new URL(location, url);
    let validated: URL;
    try {
      validated = validateUrl(nextUrl, policy);
    } catch (error) {
      if (error instanceof SsrfGuardError) {
        throw new SsrfGuardError('blocked_redirect', `Blocked redirect: ${error.message}`, {
          scheme: nextUrl.protocol.replace(/:$/, ''),
          host: nextUrl.hostname,
          url: nextUrl.toString(),
        });
      }
      throw error;
    }

    // Per the fetch spec's redirect handling: 303 always downgrades to GET;
    // 301/302 downgrade POST to GET. The body must not be replayed.
    if (
      (response.status === 303 && method !== 'GET' && method !== 'HEAD') ||
      ((response.status === 301 || response.status === 302) && method === 'POST')
    ) {
      method = 'GET';
      body = null;
      const contentHeaders: string[] = [];
      headers.forEach((_value, name) => {
        if (name.startsWith('content-')) contentHeaders.push(name);
      });
      for (const name of contentHeaders) headers.delete(name);
    }

    // Credentials must not leak to a different origin on redirect.
    if (url.origin !== validated.origin) {
      for (const name of SENSITIVE_HEADERS) headers.delete(name);
    }

    url = validated;
  }

  throw new SsrfGuardError('blocked_redirect', `Too many redirects: ${maxRedirects}`, {
    url: url.toString(),
  });
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304;
}
