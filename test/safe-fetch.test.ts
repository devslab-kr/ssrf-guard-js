import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { assertResolvedIpsAllowed, safeFetch, SsrfGuardError, UrlPolicy } from '../src/index.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

// These tests stub global fetch and mock DNS, so force the unpinned code path
// by making the optional undici import fail. Pinned mode is covered by the
// integration tests in safe-fetch-pinned.test.ts.
vi.mock('undici', () => {
  throw new Error('undici unavailable in unit tests');
});

const lookupMock = vi.mocked(lookup);
const fetchMock = vi.fn();

const policy = { exactHosts: ['api.example.com', 'cdn.example.com'], allowedSchemes: ['https'] };

const PUBLIC_IP = { address: '93.184.216.34', family: 4 };
const PRIVATE_IP = { address: '10.0.0.5', family: 4 };

function okResponse(): { status: number; headers: Headers; body: null } {
  return { status: 200, headers: new Headers(), body: null };
}

function redirectResponse(status: number, location?: string) {
  return {
    status,
    headers: new Headers(location ? { location } : {}),
    body: { cancel: vi.fn() },
  };
}

beforeEach(() => {
  lookupMock.mockResolvedValue([PUBLIC_IP] as never);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('assertResolvedIpsAllowed', () => {
  it('passes when every resolved address is public', async () => {
    await expect(
      assertResolvedIpsAllowed(new URL('https://api.example.com/'), new UrlPolicy(policy)),
    ).resolves.toBeUndefined();
  });

  it('fails closed when any resolved address is private', async () => {
    lookupMock.mockResolvedValue([PUBLIC_IP, PRIVATE_IP] as never);

    await expect(
      assertResolvedIpsAllowed(new URL('https://api.example.com/'), new UrlPolicy(policy)),
    ).rejects.toMatchObject({ reason: 'blocked_private_ip' });
  });

  it('fails when all resolved addresses are private', async () => {
    lookupMock.mockResolvedValue([PRIVATE_IP] as never);

    await expect(
      assertResolvedIpsAllowed(new URL('https://api.example.com/'), new UrlPolicy(policy)),
    ).rejects.toMatchObject({ reason: 'blocked_private_ip' });
  });

  it('fails when DNS returns no addresses', async () => {
    lookupMock.mockResolvedValue([] as never);

    await expect(
      assertResolvedIpsAllowed(new URL('https://api.example.com/'), new UrlPolicy(policy)),
    ).rejects.toMatchObject({ reason: 'blocked_private_ip' });
  });

  it('skips the DNS check when blockPrivateNetworks is false', async () => {
    await assertResolvedIpsAllowed(
      new URL('https://api.example.com/'),
      new UrlPolicy({ ...policy, blockPrivateNetworks: false }),
    );

    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe('safeFetch', () => {
  it('returns the response and always fetches with manual redirects', async () => {
    const response = okResponse();
    fetchMock.mockResolvedValue(response);

    await expect(safeFetch('https://api.example.com/data', policy)).resolves.toBe(response);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
    expect(lookupMock).toHaveBeenCalledOnce();
  });

  it('rejects disallowed URLs before any network activity', async () => {
    await expect(safeFetch('https://evil.com/', policy)).rejects.toBeInstanceOf(SsrfGuardError);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('follows an allowed redirect and re-checks DNS on every hop', async () => {
    const final = okResponse();
    fetchMock
      .mockResolvedValueOnce(redirectResponse(302, 'https://cdn.example.com/file'))
      .mockResolvedValueOnce(final);

    await expect(safeFetch('https://api.example.com/data', policy)).resolves.toBe(final);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lookupMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://cdn.example.com/file');
  });

  it('blocks redirects to hosts outside the policy', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse(302, 'https://evil.com/'));

    await expect(safeFetch('https://api.example.com/data', policy)).rejects.toMatchObject({
      reason: 'blocked_redirect',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('cancels the redirect response body before following', async () => {
    const redirect = redirectResponse(302, 'https://cdn.example.com/file');
    fetchMock.mockResolvedValueOnce(redirect).mockResolvedValueOnce(okResponse());

    await safeFetch('https://api.example.com/data', policy);

    expect(redirect.body.cancel).toHaveBeenCalledOnce();
  });

  it('returns redirect responses that have no location header', async () => {
    const dangling = redirectResponse(302);
    fetchMock.mockResolvedValueOnce(dangling);

    await expect(safeFetch('https://api.example.com/data', policy)).resolves.toBe(dangling);
  });

  it('throws after exceeding maxRedirects', async () => {
    fetchMock.mockResolvedValue(redirectResponse(302, 'https://cdn.example.com/loop'));

    await expect(
      safeFetch('https://api.example.com/data', policy, { maxRedirects: 2 }),
    ).rejects.toMatchObject({ reason: 'blocked_redirect' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('strips credentials when redirecting to a different origin', async () => {
    // safeFetch mutates one Headers instance across hops, so snapshot the
    // values at call time instead of inspecting the captured reference later.
    const snapshots: Array<Record<string, string | null>> = [];
    const responses = [redirectResponse(302, 'https://cdn.example.com/file'), okResponse()];
    fetchMock.mockImplementation((_url, init) => {
      const headers = init.headers as Headers;
      snapshots.push({
        authorization: headers.get('authorization'),
        cookie: headers.get('cookie'),
        'x-trace': headers.get('x-trace'),
      });
      return Promise.resolve(responses.shift());
    });

    await safeFetch('https://api.example.com/data', policy, {
      headers: { authorization: 'Bearer secret', cookie: 'session=1', 'x-trace': 'keep' },
    });

    expect(snapshots[0]).toEqual({ authorization: 'Bearer secret', cookie: 'session=1', 'x-trace': 'keep' });
    expect(snapshots[1]).toEqual({ authorization: null, cookie: null, 'x-trace': 'keep' });
  });

  it('keeps credentials on same-origin redirects', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse(302, 'https://api.example.com/moved'))
      .mockResolvedValueOnce(okResponse());

    await safeFetch('https://api.example.com/data', policy, {
      headers: { authorization: 'Bearer secret' },
    });

    const secondHeaders = fetchMock.mock.calls[1]![1].headers as Headers;
    expect(secondHeaders.get('authorization')).toBe('Bearer secret');
  });

  it('downgrades 303 redirects to GET and drops the body', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse(303, 'https://api.example.com/result'))
      .mockResolvedValueOnce(okResponse());

    await safeFetch('https://api.example.com/submit', policy, {
      method: 'POST',
      body: 'payload',
      headers: { 'content-type': 'application/json' },
    });

    const second = fetchMock.mock.calls[1]![1];
    expect(second.method).toBe('GET');
    expect(second.body).toBeNull();
    expect((second.headers as Headers).get('content-type')).toBeNull();
  });

  it('downgrades 302 POST redirects to GET', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse(302, 'https://api.example.com/moved'))
      .mockResolvedValueOnce(okResponse());

    await safeFetch('https://api.example.com/submit', policy, { method: 'POST', body: 'payload' });

    const second = fetchMock.mock.calls[1]![1];
    expect(second.method).toBe('GET');
    expect(second.body).toBeNull();
  });

  it('reports the final URL after redirects via onFinalUrl', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse(302, 'https://cdn.example.com/file'))
      .mockResolvedValueOnce(okResponse());

    const finalUrls: string[] = [];
    await safeFetch('https://api.example.com/data', policy, {
      onFinalUrl: (url) => finalUrls.push(url.toString()),
    });

    expect(finalUrls).toEqual(['https://cdn.example.com/file']);
  });

  it('throws a clear error when pinDns is required but undici is missing', async () => {
    await expect(
      safeFetch('https://api.example.com/data', policy, { pinDns: true }),
    ).rejects.toMatchObject({ reason: 'blocked_other' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks the initial request when DNS includes a private address', async () => {
    lookupMock.mockResolvedValue([PUBLIC_IP, PRIVATE_IP] as never);

    await expect(safeFetch('https://api.example.com/data', policy)).rejects.toMatchObject({
      reason: 'blocked_private_ip',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The cap lives in the shared redirect loop, so it reaches safeFetch too.
  // response-cap.test.ts covers the behaviour; this pins the wiring.
  it('honours maxBytes', async () => {
    fetchMock.mockResolvedValue(
      new Response('x'.repeat(500), { headers: { 'content-length': '500' } }),
    );

    await expect(
      safeFetch('https://api.example.com/big', policy, { maxBytes: 100 }),
    ).rejects.toMatchObject({ reason: 'blocked_response_size' });
  });

  it('rejects an invalid maxBytes before resolving anything', async () => {
    await expect(
      safeFetch('https://api.example.com/data', policy, { maxBytes: Number.NaN }),
    ).rejects.toThrow(TypeError);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
