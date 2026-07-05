import { lookup } from 'node:dns/promises';
import { SsrfGuardError } from './error.js';
import { isPrivateOrLocalIp, normalizeHost } from './net.js';
import { UrlPolicy, validateUrl } from './policy.js';
import type { UrlPolicyOptions } from './types.js';

export interface SafeFetchOptions extends RequestInit {
  maxRedirects?: number;
  /**
   * Pin connections to the DNS-validated IP so the check and the socket use a
   * single resolution, closing the DNS-rebinding window. Requires the optional
   * `undici` dependency.
   *
   * - `true`: require pinning; throws if `undici` is not installed.
   * - `false`: disable pinning; falls back to check-then-fetch.
   * - unset: pin automatically when `undici` is installed.
   */
  pinDns?: boolean;
}

const SENSITIVE_HEADERS = ['authorization', 'proxy-authorization', 'cookie'];

type FetchLike = (
  input: string | URL,
  init: RequestInit & { dispatcher?: unknown },
) => Promise<Response>;

interface DnsAddress {
  address: string;
  family: number;
}

type ConnectorLookup = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (error: Error | null, address?: string | DnsAddress[], family?: number) => void,
) => void;

interface UndiciLike {
  Agent: new (options: { connect: { lookup: ConnectorLookup } }) => object;
  fetch: FetchLike;
}

let undiciPromise: Promise<UndiciLike | null> | undefined;

function loadUndici(): Promise<UndiciLike | null> {
  undiciPromise ??= import('undici').then(
    (module) => module as unknown as UndiciLike,
    () => null,
  );
  return undiciPromise;
}

const pinnedAgents = new WeakMap<UrlPolicy, object>();

function getPinnedAgent(undici: UndiciLike, policy: UrlPolicy): object {
  let agent = pinnedAgents.get(policy);
  if (!agent) {
    agent = new undici.Agent({ connect: { lookup: createValidatingLookup(policy) } });
    pinnedAgents.set(policy, agent);
  }
  return agent;
}

function createValidatingLookup(policy: UrlPolicy): ConnectorLookup {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true, verbatim: true }).then(
      (addresses) => {
        if (policy.options.blockPrivateNetworks) {
          const blocked = addresses.find((address) => isPrivateOrLocalIp(address.address));
          if (blocked) {
            callback(
              new SsrfGuardError(
                'blocked_private_ip',
                `DNS resolved a private/local address for ${hostname}: ${blocked.address}`,
                { host: hostname },
              ),
            );
            return;
          }
        }

        const candidates =
          options.family && addresses.some((address) => address.family === options.family)
            ? addresses.filter((address) => address.family === options.family)
            : addresses;
        const picked = candidates[0];
        if (!picked) {
          callback(
            new SsrfGuardError('blocked_private_ip', `DNS returned no addresses for ${hostname}`, {
              host: hostname,
            }),
          );
          return;
        }

        if (options.all) {
          callback(null, [{ address: picked.address, family: picked.family }]);
        } else {
          callback(null, picked.address, picked.family);
        }
      },
      (error) => callback(error as Error),
    );
  };
}

function findGuardError(error: unknown): SsrfGuardError | null {
  let current = error;
  for (let depth = 0; current && depth < 10; depth += 1) {
    if (current instanceof SsrfGuardError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export async function safeFetch(
  input: string | URL,
  policy: UrlPolicyOptions | UrlPolicy,
  init: SafeFetchOptions = {},
): Promise<Response> {
  const urlPolicy = policy instanceof UrlPolicy ? policy : new UrlPolicy(policy);
  let url = validateUrl(input, urlPolicy);
  const { maxRedirects = 5, pinDns, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  let method = (requestInit.method ?? 'GET').toUpperCase();
  let body = requestInit.body ?? null;

  const undici = pinDns === false ? null : await loadUndici();
  if (pinDns === true && !undici) {
    throw new SsrfGuardError(
      'blocked_other',
      'pinDns: true requires the optional dependency "undici" to be installed',
      { url: url.toString() },
    );
  }
  const doFetch: FetchLike = undici ? undici.fetch : fetch;
  const dispatcher = undici ? getPinnedAgent(undici, urlPolicy) : undefined;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    // Unpinned mode checks DNS before connecting; pinned mode validates inside
    // the connector's lookup, so check and connection share one resolution.
    if (!undici) await assertResolvedIpsAllowed(url, urlPolicy);

    let response: Response;
    try {
      response = await doFetch(url, {
        ...requestInit,
        method,
        body,
        headers,
        redirect: 'manual',
        ...(dispatcher ? { dispatcher } : {}),
      });
    } catch (error) {
      // Pinned lookups surface SsrfGuardError wrapped in undici's fetch error.
      const guardError = findGuardError(error);
      if (guardError) throw guardError;
      throw error;
    }

    if (!isRedirect(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) return response;

    await response.body?.cancel();

    const nextUrl = new URL(location, url);
    let validated: URL;
    try {
      validated = validateUrl(nextUrl, urlPolicy);
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

export async function assertResolvedIpsAllowed(url: URL, policy: UrlPolicy): Promise<void> {
  if (!policy.options.blockPrivateNetworks) return;

  const host = normalizeHost(url.hostname);
  if (!host) {
    throw new SsrfGuardError('blocked_host', 'URL is missing a host', {
      scheme: url.protocol.replace(/:$/, ''),
      host,
      url: url.toString(),
    });
  }

  const addresses = await lookup(host, { all: true, verbatim: true });
  const blocked = addresses.find((address) => isPrivateOrLocalIp(address.address));
  if (blocked || addresses.length === 0) {
    throw new SsrfGuardError(
      'blocked_private_ip',
      blocked
        ? `DNS resolved a private/local address for ${host}: ${blocked.address}`
        : `DNS returned no addresses for ${host}`,
      {
        scheme: url.protocol.replace(/:$/, ''),
        host,
        url: url.toString(),
      },
    );
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304;
}
