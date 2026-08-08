import { SsrfGuardError } from './error.js';
import { HostPolicy } from './host-policy.js';
import { looksLikeIpLiteral, normalizeHost } from './net.js';
import type { NormalizedUrlPolicy, UrlPolicyOptions } from './types.js';

const DEFAULT_ALLOWED_SCHEMES = ['http', 'https'] as const;
const DEFAULT_ALLOWED_PORTS = [-1, 80, 443] as const;

export class UrlPolicy {
  readonly options: NormalizedUrlPolicy;
  readonly hostPolicy: HostPolicy;

  constructor(options: UrlPolicyOptions = {}) {
    this.hostPolicy = new HostPolicy(options.exactHosts ?? [], options.suffixes ?? []);
    this.options = Object.freeze({
      exactHosts: this.hostPolicy.exactHosts,
      suffixes: this.hostPolicy.suffixes,
      allowedSchemes: new Set((options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES).map((scheme) => scheme.toLowerCase())),
      allowedPorts: new Set(options.allowedPorts ?? DEFAULT_ALLOWED_PORTS),
      rejectIpLiteralHosts: options.rejectIpLiteralHosts ?? true,
      rejectUserInfo: options.rejectUserInfo ?? true,
      blockPrivateNetworks: options.blockPrivateNetworks ?? true,
    });
  }

  validate(input: string | URL): URL {
    const url = toUrl(input);
    const scheme = url.protocol.replace(/:$/, '').toLowerCase();
    const host = normalizeHost(url.hostname);

    if (this.options.rejectUserInfo && (url.username || url.password)) {
      throw new SsrfGuardError('blocked_userinfo', 'URL must not contain userinfo (user:pass@)', {
        scheme,
        host,
        url: url.toString(),
      });
    }

    if (!this.options.allowedSchemes.has(scheme)) {
      throw new SsrfGuardError('blocked_scheme', `Blocked scheme: ${scheme}`, {
        scheme,
        host,
        url: url.toString(),
      });
    }

    if (!host) {
      throw new SsrfGuardError('blocked_host', 'URL is missing a host', {
        scheme,
        host,
        url: url.toString(),
      });
    }

    if (this.options.rejectIpLiteralHosts && looksLikeIpLiteral(host)) {
      throw new SsrfGuardError('blocked_ip_literal', `IP-literal host blocked: ${host}`, {
        scheme,
        host,
        url: url.toString(),
      });
    }

    if (!this.hostPolicy.allows(host)) {
      throw new SsrfGuardError('blocked_host', `Host not allowed: ${host}`, {
        scheme,
        host,
        url: url.toString(),
      });
    }

    const port = url.port === '' ? defaultPortForScheme(scheme) : Number(url.port);
    if (!this.options.allowedPorts.has(port)) {
      throw new SsrfGuardError('blocked_port', `Blocked port: ${port}`, {
        scheme,
        host,
        url: url.toString(),
      });
    }

    return url;
  }

  /**
   * `validate` without the throw. Deliberately implemented by catching
   * `validate` rather than by re-deriving the checks: a second
   * implementation would be free to drift from the one the fetch guards
   * actually enforce, and a predicate that disagrees with the guard is
   * worse than no predicate — it makes callers confident about the
   * wrong answer.
   */
  check(input: string | URL): UrlCheckResult {
    try {
      return { allowed: true, url: this.validate(input) };
    } catch (error) {
      if (error instanceof SsrfGuardError) return { allowed: false, error };
      throw error;
    }
  }
}

/**
 * The outcome of a non-throwing policy check. Read `error.reason` for a
 * stable `BlockReason` when `allowed` is `false`.
 */
export type UrlCheckResult =
  | { allowed: true; url: URL }
  | { allowed: false; error: SsrfGuardError };

export function validateUrl(input: string | URL, policy: UrlPolicyOptions | UrlPolicy = {}): URL {
  return policy instanceof UrlPolicy ? policy.validate(input) : new UrlPolicy(policy).validate(input);
}

/**
 * Ask the policy about a URL without exceptions — for the "should I even
 * try this one?" decisions that surround a guarded fetch: which links a
 * crawler enqueues, which of a batch of URLs to report as rejected, which
 * candidate to show a user. Same code path as `validateUrl`, so the answer
 * always agrees with what the fetch guards would do.
 *
 * ```ts
 * const result = checkUrl(link, policy);
 * if (!result.allowed) log.debug(`skipped ${link}: ${result.error.reason}`);
 * ```
 *
 * This is a URL-time answer only. It says nothing about where the host
 * resolves — `safeFetch`'s DNS checks have no non-throwing equivalent,
 * because knowing that requires actually resolving.
 */
export function checkUrl(
  input: string | URL,
  policy: UrlPolicyOptions | UrlPolicy = {},
): UrlCheckResult {
  return policy instanceof UrlPolicy ? policy.check(input) : new UrlPolicy(policy).check(input);
}

/** `checkUrl` reduced to a boolean, for `filter`/`if` call sites. */
export function isUrlAllowed(
  input: string | URL,
  policy: UrlPolicyOptions | UrlPolicy = {},
): boolean {
  return checkUrl(input, policy).allowed;
}

function defaultPortForScheme(scheme: string): number {
  switch (scheme) {
    case 'http':
    case 'ws':
      return 80;
    case 'https':
    case 'wss':
      return 443;
    default:
      return -1;
  }
}

function toUrl(input: string | URL): URL {
  if (input instanceof URL) return input;
  try {
    return new URL(input);
  } catch (error) {
    throw new SsrfGuardError('blocked_other', `Invalid URL: ${input}`, {
      url: input,
      cause: error,
    });
  }
}
