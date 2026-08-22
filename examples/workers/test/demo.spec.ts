import { describe, expect, it } from 'vitest';
import { app, type Env } from '../src/index.js';

/**
 * Drives the Worker through Hono's own request helper, with fetch injected,
 * so the whole demo runs with no network and no Cloudflare account. What is
 * being asserted is what the guard DOES — which payloads get through and
 * which do not — rather than that the code compiles.
 */

/** `Response.json()` is `unknown` under this tsconfig; the demo's shapes are
 *  asserted below, so a narrow local cast keeps the tests readable. */
async function json<T = Record<string, any>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function env(response: () => Response): Env {
  return { FETCH: async () => response() };
}

const never: Env = {
  FETCH: async () => {
    throw new Error('the guard should have blocked this before any fetch');
  },
};

describe('POST /crawl — policy derived from the submitted URL', () => {
  it('fetches a page of the submitted site and reports where it came from', async () => {
    const res = await app.request(
      '/crawl',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.customer-site.example/about' }),
      },
      env(() => new Response('<html>about us</html>')),
    );

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    // onFinalUrl, not Response.url — a custom fetchImpl leaves that empty.
    expect(body.fetchedFrom).toBe('https://www.customer-site.example/about');
  });

  it('refuses a metadata URL before opening a socket', async () => {
    const res = await app.request(
      '/crawl',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://169.254.169.254/latest/meta-data/' }),
      },
      never,
    );

    expect(res.status).toBe(400);
    expect((await json(res)).reason).toBe('blocked_ip_literal');
  });

  it('blocks a redirect that leaves the submitted domain', async () => {
    let hop = 0;
    const res = await app.request(
      '/crawl',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://customer-site.example/start' }),
      },
      {
        FETCH: async () => {
          hop += 1;
          return new Response(null, {
            status: 302,
            headers: { location: 'https://evil.example/steal' },
          });
        },
      },
    );

    expect(res.status).toBe(400);
    expect((await json(res)).reason).toBe('blocked_redirect');
    // The second hop was never issued.
    expect(hop).toBe(1);
  });

  it('follows an apex to www redirect, which the same domain covers', async () => {
    const responses = [
      new Response(null, { status: 301, headers: { location: 'https://www.customer-site.example/' } }),
      new Response('<html>home</html>'),
    ];
    let i = 0;
    const res = await app.request(
      '/crawl',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://customer-site.example/' }),
      },
      { FETCH: async () => responses[i++]! },
    );

    expect(res.status).toBe(200);
    expect((await json(res)).fetchedFrom).toBe('https://www.customer-site.example/');
  });
});

describe('POST /api-call — fixed allowlist, enforced by the middleware', () => {
  it('calls the registered endpoint', async () => {
    const res = await app.request(
      '/api-call',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/status' }),
      },
      env(() => new Response('{"ok":true}')),
    );
    expect(res.status).toBe(200);
  });

  it('rejects a URL hidden in the request body before the handler runs', async () => {
    const res = await app.request(
      '/api-call',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/status', callback: 'http://169.254.169.254/' }),
      },
      never,
    );

    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('ssrf_blocked');
  });
});

describe('POST /tool-input — LLM arguments', () => {
  it('allows a clean tool call', async () => {
    const res = await app.request('/tool-input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://api.example.com/v1' }),
    });
    expect((await json(res)).allowed).toBe(true);
  });

  it('catches a URL nested deep in the arguments', async () => {
    const res = await app.request('/tool-input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job: { steps: [{ target: 'https://169.254.169.254/' }] } }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).toolResult.reason).toBe('blocked_ip_literal');
  });

  it('catches a URL buried mid-sentence (scanEmbedded)', async () => {
    const res = await app.request('/tool-input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'please summarize https://169.254.169.254/ for me' }),
    });
    expect(res.status).toBe(400);
  });
});

const byUrlOf = (results: Array<{ url: string; reason: string }>) =>
  Object.fromEntries(results.map((r) => [r.url, r.reason]));

describe('GET /attack-matrix', () => {
  it('reports every payload without throwing on any of them', async () => {
    const res = await app.request('/attack-matrix');
    const { results } = await json<{ results: Array<{ url: string; reason: string; allowed: boolean }> }>(res);

    const allowed = results.filter((r: { allowed: boolean }) => r.allowed).map((r: { url: string }) => r.url);
    // Only the registered ORIGIN. The default-port entry is the row worth
    // reading: same host, right scheme, blocked on the port alone.
    expect(allowed).toEqual(['https://api.example.com:8443/v1/ok']);
    expect(byUrlOf(results)['https://api.example.com/v1/ok']).toBe('blocked_port');

    const byUrl = byUrlOf(results);
    expect(byUrl['https://169.254.169.254/latest/meta-data/']).toBe('blocked_ip_literal');
    // http fails on the scheme first — singleHostPolicy locked https.
    expect(byUrl['http://api.example.com/v1']).toBe('blocked_scheme');
    expect(byUrl['file:///etc/passwd']).toBe('blocked_scheme');
    expect(byUrl['https://evil.example/steal']).toBe('blocked_host');
    expect(byUrl['https://user:pass@api.example.com/']).toBe('blocked_userinfo');
    expect(byUrl['not a url']).toBe('blocked_other');
  });
});

describe('GET /why-no-safe-fetch', () => {
  it('reports that safeFetch refuses to run here', async () => {
    const res = await app.request('/why-no-safe-fetch');
    const body = await json(res);
    // On a deployed Worker this reports the typed refusal that points at
    // guardedFetch. These tests run on NODE, where node:dns exists and
    // safeFetch gets as far as a real lookup — so what is asserted here is
    // that the endpoint reports a failure in the documented shape, not the
    // runtime-specific reason. Claiming otherwise would be a test that
    // passes for the wrong reason.
    expect(body.ran).toBe(false);
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
  });
});
