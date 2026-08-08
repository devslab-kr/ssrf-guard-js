import { SsrfGuardError } from './error.js';
import { normalizeHost } from './net.js';
import { defaultPortForScheme, UrlPolicy, validateUrl } from './policy.js';
import { followRedirectsGuarded, type FetchImpl } from './redirect.js';
import { normalizeMaxBytes } from './response-cap.js';
import type { UrlPolicyOptions } from './types.js';

/**
 * URL-time guarded fetch for runtimes that cannot run `safeFetch`'s
 * DNS checks — Cloudflare Workers, browsers, edge runtimes. Validates
 * the URL and EVERY redirect hop against the policy before following,
 * with the same header-stripping and method-downgrade semantics as
 * `safeFetch`, but performs no DNS resolution and no IP pinning.
 *
 * That gap is real: a hostname that resolves to a private address
 * passes URL-time checks. The policy allowlist (`exactHosts` /
 * `suffixes`) is therefore the primary control here — `guardedFetch`
 * inherits the package's fail-closed default (empty allowlist allows
 * nothing). To open a specific host, put it in the allowlist; for
 * "crawl the customer's own site" flows, derive the allowlist from the
 * submitted URL with `sameSitePolicy`. For genuinely arbitrary URL
 * fetching, use `safeFetch` in a Node egress service instead.
 */

export interface GuardedFetchOptions extends RequestInit {
  maxRedirects?: number;
  /** Override the fetch implementation (tests, instrumented clients). */
  fetchImpl?: FetchImpl;
  /**
   * Called with the final validated URL — the last hop's URL after all
   * redirects were followed. More reliable than `Response.url`, which
   * a custom `fetchImpl` (test fakes, instrumented clients) may leave
   * empty. Not called when the fetch throws.
   */
  onFinalUrl?: (url: URL) => void;
  /**
   * Maximum response body size in bytes. An oversized body is rejected
   * with a `blocked_response_size` `SsrfGuardError` — on the declared
   * `Content-Length` before anything is read, or mid-stream at read
   * time when the length is absent or understated. Never truncated
   * silently. Must be a non-negative integer.
   */
  maxBytes?: number;
}

export async function guardedFetch(
  input: string | URL,
  policy: UrlPolicyOptions | UrlPolicy,
  init: GuardedFetchOptions = {},
): Promise<Response> {
  const urlPolicy = policy instanceof UrlPolicy ? policy : new UrlPolicy(policy);
  const url = validateUrl(input, urlPolicy);
  const { maxRedirects = 5, fetchImpl, onFinalUrl, maxBytes, ...requestInit } = init;
  const cap = normalizeMaxBytes(maxBytes);

  return followRedirectsGuarded({
    url,
    policy: urlPolicy,
    init: requestInit,
    maxRedirects,
    fetchImpl: fetchImpl ?? ((u, i) => fetch(u, i)),
    ...(onFinalUrl ? { onFinalUrl } : {}),
    ...(cap === undefined ? {} : { maxBytes: cap }),
  });
}

/**
 * Policy for "fetch pages from the site the user just submitted":
 * locks the whole fetch — redirects included — to the submitted URL's
 * domain. A leading `www.` is stripped so apex ↔ www redirects
 * survive; subdomains of the registered host stay reachable.
 *
 * `overrides` merges on top, so callers can still open extra hosts
 * (`exactHosts`/`suffixes` are additive) or tighten schemes/ports:
 *
 * ```ts
 * await guardedFetch(input, sameSitePolicy(input, { allowedSchemes: ['https'] }));
 * ```
 */
export function sameSitePolicy(
  input: string | URL,
  overrides: UrlPolicyOptions = {},
): UrlPolicyOptions {
  let host: string | null;
  try {
    host = normalizeHost((input instanceof URL ? input : new URL(input)).hostname);
  } catch (error) {
    throw new SsrfGuardError('blocked_other', `Invalid URL: ${String(input)}`, {
      url: String(input),
      cause: error,
    });
  }
  if (!host) {
    throw new SsrfGuardError('blocked_host', 'URL is missing a host', {
      url: String(input),
    });
  }
  const site = host.replace(/^www\./, '');
  return {
    ...overrides,
    suffixes: [...(overrides.suffixes ?? []), site],
  };
}

/**
 * Policy for "talk to exactly this endpoint and nowhere else": locks the
 * fetch — redirects included — to the given URL's **origin**, meaning its
 * scheme, host, and port together. No `www.` peer, no subdomains.
 *
 * The sibling of `sameSitePolicy`, for the other intent. Use this one for
 * a registered API base, a webhook target, a configured upstream —
 * anywhere the exact endpoint is known and anything else is a mistake.
 * Use `sameSitePolicy` when the input is a site a user submitted and the
 * whole domain is fair game.
 *
 * Locking the port matters and is easy to get wrong by hand: a base of
 * `https://api.example.com:8443/v1` needs `8443` allowed, which the
 * package's default `allowedPorts` does not include. A hand-written
 * `{ exactHosts: [u.hostname] }` therefore rejects its own base URL —
 * quietly, and only for the non-standard-port deployments.
 *
 * ```ts
 * await guardedFetch(target, singleHostPolicy(registeredApiBase));
 * ```
 *
 * `overrides` merges on top. Note that `exactHosts` and `suffixes` are
 * additive, so passing them widens the lock rather than replacing it.
 */
export function singleHostPolicy(
  input: string | URL,
  overrides: UrlPolicyOptions = {},
): UrlPolicyOptions {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch (error) {
    throw new SsrfGuardError('blocked_other', `Invalid URL: ${String(input)}`, {
      url: String(input),
      cause: error,
    });
  }

  const host = normalizeHost(url.hostname);
  if (!host) {
    throw new SsrfGuardError('blocked_host', 'URL is missing a host', {
      url: String(input),
    });
  }

  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  const port = url.port === '' ? defaultPortForScheme(scheme) : Number(url.port);

  return {
    ...overrides,
    exactHosts: [...(overrides.exactHosts ?? []), host],
    allowedSchemes: overrides.allowedSchemes ?? [scheme],
    allowedPorts: overrides.allowedPorts ?? [port],
  };
}
