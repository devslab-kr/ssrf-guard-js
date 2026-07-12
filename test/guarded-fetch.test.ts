import { describe, expect, it, vi } from 'vitest';
import { guardedFetch, sameSitePolicy, SsrfGuardError, UrlPolicy } from '../src/index.js';
import type { FetchImpl } from '../src/index.js';

// guardedFetch never touches DNS, so unlike safe-fetch.test.ts nothing
// is mocked at the module level — a scripted fetchImpl is the whole
// runtime boundary. That is the point of the API.

function okResponse(body = 'ok'): Response {
  return new Response(body, { status: 200 });
}

function redirectResponse(status: number, location?: string): Response {
  return new Response(null, {
    status,
    headers: location ? { location } : {},
  });
}

function scriptedFetch(
  responses: Response[],
): FetchImpl & { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const impl: FetchImpl = async (url, init) => {
    calls.push({ url: url.toString(), init });
    const res = responses[i++];
    if (!res) throw new Error('no more scripted responses');
    return res;
  };
  return Object.assign(impl, { calls });
}

const policy = { exactHosts: ['api.example.com', 'cdn.example.com'], allowedSchemes: ['https'] };

describe('guardedFetch', () => {
  it('fetches an allowlisted URL', async () => {
    const fetchImpl = scriptedFetch([okResponse()]);
    const res = await guardedFetch('https://api.example.com/data', policy, { fetchImpl });
    expect(res.status).toBe(200);
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]!.init.redirect).toBe('manual');
  });

  it('fails closed on an empty allowlist', async () => {
    const fetchImpl = scriptedFetch([]);
    await expect(guardedFetch('https://anywhere.example/', {}, { fetchImpl })).rejects.toMatchObject(
      { reason: 'blocked_host' },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('follows an allowlisted redirect and revalidates the hop', async () => {
    const fetchImpl = scriptedFetch([
      redirectResponse(302, 'https://cdn.example.com/asset'),
      okResponse(),
    ]);
    const res = await guardedFetch('https://api.example.com/asset', policy, { fetchImpl });
    expect(res.status).toBe(200);
    expect(fetchImpl.calls.map((c) => c.url)).toEqual([
      'https://api.example.com/asset',
      'https://cdn.example.com/asset',
    ]);
  });

  it('blocks a redirect that leaves the allowlist, without fetching it', async () => {
    const fetchImpl = scriptedFetch([redirectResponse(302, 'https://evil.example/steal')]);
    await expect(
      guardedFetch('https://api.example.com/', policy, { fetchImpl }),
    ).rejects.toMatchObject({ reason: 'blocked_redirect' });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('strips credentials when a redirect changes origin', async () => {
    const fetchImpl = scriptedFetch([
      redirectResponse(302, 'https://cdn.example.com/asset'),
      okResponse(),
    ]);
    await guardedFetch('https://api.example.com/asset', policy, {
      fetchImpl,
      headers: { authorization: 'Bearer secret', accept: 'text/html' },
    });
    const secondHeaders = new Headers(fetchImpl.calls[1]!.init.headers);
    expect(secondHeaders.get('authorization')).toBeNull();
    expect(secondHeaders.get('accept')).toBe('text/html');
  });

  it('downgrades a 303 POST to GET and drops the body', async () => {
    const fetchImpl = scriptedFetch([
      redirectResponse(303, 'https://api.example.com/next'),
      okResponse(),
    ]);
    await guardedFetch('https://api.example.com/form', policy, {
      fetchImpl,
      method: 'POST',
      body: 'payload',
      headers: { 'content-type': 'text/plain' },
    });
    const second = fetchImpl.calls[1]!;
    expect(second.init.method).toBe('GET');
    expect(second.init.body).toBeNull();
    expect(new Headers(second.init.headers).get('content-type')).toBeNull();
  });

  it('gives up after maxRedirects', async () => {
    const hops = Array.from({ length: 4 }, () =>
      redirectResponse(302, 'https://api.example.com/again'),
    );
    await expect(
      guardedFetch('https://api.example.com/', policy, {
        fetchImpl: scriptedFetch(hops),
        maxRedirects: 2,
      }),
    ).rejects.toMatchObject({ reason: 'blocked_redirect' });
  });

  it('accepts a prebuilt UrlPolicy', async () => {
    const fetchImpl = scriptedFetch([okResponse()]);
    const res = await guardedFetch('https://api.example.com/', new UrlPolicy(policy), {
      fetchImpl,
    });
    expect(res.status).toBe(200);
  });
});

describe('sameSitePolicy', () => {
  it('locks the policy to the submitted domain, www stripped', () => {
    expect(sameSitePolicy('https://www.acme.example/about')).toEqual({
      suffixes: ['acme.example'],
    });
    expect(sameSitePolicy(new URL('https://acme.example/'))).toEqual({
      suffixes: ['acme.example'],
    });
  });

  it('lets the crawl reach subdomains but not other sites', async () => {
    const input = 'https://www.acme.example/about';
    const fetchImpl = scriptedFetch([
      redirectResponse(302, 'https://docs.acme.example/about'),
      okResponse(),
    ]);
    await expect(
      guardedFetch(input, sameSitePolicy(input), { fetchImpl }),
    ).resolves.toMatchObject({ status: 200 });

    const escape = scriptedFetch([redirectResponse(302, 'https://not-acme.example/')]);
    await expect(
      guardedFetch(input, sameSitePolicy(input), { fetchImpl: escape }),
    ).rejects.toMatchObject({ reason: 'blocked_redirect' });
  });

  it('merges overrides additively — extra hosts stay reachable', () => {
    const merged = sameSitePolicy('https://acme.example/', {
      suffixes: ['assets.example'],
      allowedSchemes: ['https'],
    });
    expect(merged.suffixes).toEqual(['assets.example', 'acme.example']);
    expect(merged.allowedSchemes).toEqual(['https']);
  });

  it('throws a typed error for unparseable or hostless input', () => {
    expect(() => sameSitePolicy('not a url')).toThrowError(SsrfGuardError);
    expect(() => sameSitePolicy('not a url')).toThrowError(/Invalid URL/);
  });
});
