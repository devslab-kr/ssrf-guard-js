import { SsrfGuardError } from './error.js';
import { isPrivateOrLocalIp, normalizeHost } from './net.js';
import { UrlPolicy, validateUrl } from './policy.js';
import { followRedirectsGuarded, type FetchImpl } from './redirect.js';
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
  /**
   * Called with the final validated URL — the last hop's URL after all
   * redirects were followed. More reliable than `Response.url`, which
   * some fetch implementations leave empty. Not called when the fetch
   * throws.
   */
  onFinalUrl?: (url: URL) => void;
}

interface DnsAddress {
  address: string;
  family: number;
}

type LookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<DnsAddress[]>;

// node:dns is imported lazily so merely loading this module (it is
// re-exported from the package index) works on runtimes without a
// functional dns.lookup — Workers, browsers, Deno. Calling safeFetch
// there fails with a pointer to guardedFetch instead of a load error.
let lookupPromise: Promise<LookupFn | null> | undefined;

function loadLookup(): Promise<LookupFn | null> {
  lookupPromise ??= import('node:dns/promises').then(
    (module) => module.lookup as unknown as LookupFn,
    () => null,
  );
  return lookupPromise;
}

async function requireLookup(url: URL): Promise<LookupFn> {
  const lookup = await loadLookup();
  if (!lookup) {
    throw new SsrfGuardError(
      'blocked_other',
      'safeFetch requires node:dns (Node.js). On runtimes without it — Cloudflare Workers, browsers — use guardedFetch with a strict allowlist instead.',
      { url: url.toString() },
    );
  }
  return lookup;
}

type ConnectorLookup = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (error: Error | null, address?: string | DnsAddress[], family?: number) => void,
) => void;

interface UndiciLike {
  Agent: new (options: { connect: { lookup: ConnectorLookup } }) => object;
  fetch: FetchImpl;
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
    loadLookup()
      .then((lookup) => {
        if (!lookup) {
          throw new SsrfGuardError(
            'blocked_other',
            'safeFetch requires node:dns (Node.js) for its DNS checks',
            { host: hostname },
          );
        }
        return lookup(hostname, { all: true, verbatim: true });
      })
      .then(
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
  const url = validateUrl(input, urlPolicy);
  const { maxRedirects = 5, pinDns, onFinalUrl, ...requestInit } = init;

  const undici = pinDns === false ? null : await loadUndici();
  if (pinDns === true && !undici) {
    throw new SsrfGuardError(
      'blocked_other',
      'pinDns: true requires the optional dependency "undici" to be installed',
      { url: url.toString() },
    );
  }
  const fetchImpl: FetchImpl = undici ? undici.fetch : (u, i) => fetch(u, i);
  const dispatcher = undici ? getPinnedAgent(undici, urlPolicy) : undefined;

  return followRedirectsGuarded({
    url,
    policy: urlPolicy,
    init: requestInit,
    maxRedirects,
    fetchImpl,
    ...(onFinalUrl ? { onFinalUrl } : {}),
    // Unpinned mode checks DNS before connecting; pinned mode validates inside
    // the connector's lookup, so check and connection share one resolution.
    ...(undici
      ? {}
      : { beforeHop: (hopUrl: URL) => assertResolvedIpsAllowed(hopUrl, urlPolicy) }),
    // Pinned lookups surface SsrfGuardError wrapped in undici's fetch error.
    mapFetchError: (error) => findGuardError(error) ?? error,
    ...(dispatcher ? { extraInit: { dispatcher } } : {}),
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

  const lookup = await requireLookup(url);
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
