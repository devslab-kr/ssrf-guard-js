import { lookup } from 'node:dns/promises';
import { SsrfGuardError } from './error.js';
import { isPrivateOrLocalIp, normalizeHost } from './net.js';
import { UrlPolicy, validateUrl } from './policy.js';
import type { UrlPolicyOptions } from './types.js';

export interface SafeFetchOptions extends RequestInit {
  maxRedirects?: number;
}

const SENSITIVE_HEADERS = ['authorization', 'proxy-authorization', 'cookie'];

export async function safeFetch(
  input: string | URL,
  policy: UrlPolicyOptions | UrlPolicy,
  init: SafeFetchOptions = {},
): Promise<Response> {
  const urlPolicy = policy instanceof UrlPolicy ? policy : new UrlPolicy(policy);
  let url = validateUrl(input, urlPolicy);
  const { maxRedirects = 5, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  let method = (requestInit.method ?? 'GET').toUpperCase();
  let body = requestInit.body ?? null;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    await assertResolvedIpsAllowed(url, urlPolicy);
    const response = await fetch(url, { ...requestInit, method, body, headers, redirect: 'manual' });

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
