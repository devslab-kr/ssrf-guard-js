import { lookup } from 'node:dns/promises';
import { SsrfGuardError } from './error.js';
import { isPrivateOrLocalIp, normalizeHost } from './net.js';
import { UrlPolicy, validateUrl } from './policy.js';
import type { UrlPolicyOptions } from './types.js';

export interface SafeFetchOptions extends RequestInit {
  maxRedirects?: number;
}

export async function safeFetch(
  input: string | URL,
  policy: UrlPolicyOptions | UrlPolicy,
  init: SafeFetchOptions = {},
): Promise<Response> {
  const urlPolicy = policy instanceof UrlPolicy ? policy : new UrlPolicy(policy);
  let url = validateUrl(input, urlPolicy);
  const maxRedirects = init.maxRedirects ?? 5;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    await assertResolvedIpsAllowed(url, urlPolicy);
    const response = await fetch(url, { ...init, redirect: 'manual' });

    if (!isRedirect(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) return response;

    const nextUrl = new URL(location, url);
    try {
      url = validateUrl(nextUrl, urlPolicy);
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
  const allowed = addresses.filter((address) => !isPrivateOrLocalIp(address.address));
  if (allowed.length === 0) {
    throw new SsrfGuardError('blocked_private_ip', `DNS resolved only to private/local addresses: ${host}`, {
      scheme: url.protocol.replace(/:$/, ''),
      host,
      url: url.toString(),
    });
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304;
}
