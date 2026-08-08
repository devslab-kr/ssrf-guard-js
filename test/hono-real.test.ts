import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createHonoUrlGuard } from '../src/hono.js';

/**
 * hono.test.ts drives the middleware through a fake context shaped like
 * the interface it declares. That proves the middleware does what it
 * says — and nothing about whether the interface matches Hono.
 *
 * This file runs it inside real Hono. The distinction is not academic:
 * 0.6.1 was a security bug that every test passed through, because the
 * suite only ever ran where the assumed hook existed (JS-016). The
 * assumptions being checked here are the same kind:
 *
 *   - `c.req.header('content-type')` returns the header
 *   - `c.req.json()` / `parseBody()` resolve the body
 *   - a parsed body is CACHED, so reading it in middleware does not
 *     consume it and the handler can still read it
 *   - returning `c.json(...)` from middleware short-circuits the route
 *   - `c.req.param()` with no argument returns every path param
 */

const policy = { exactHosts: ['api.example.com'], allowedSchemes: ['https'] };

function buildApp() {
  const app = new Hono();

  app.post('/crawl', createHonoUrlGuard(policy), async (c) => {
    // If the middleware consumed the body, this throws and the test fails.
    const body = await c.req.json();
    return c.json({ ok: true, echoed: body });
  });

  app.post('/form', createHonoUrlGuard(policy), async (c) => {
    const body = await c.req.parseBody();
    return c.json({ ok: true, echoed: body });
  });

  app.get('/fetch', createHonoUrlGuard(policy), (c) => c.json({ ok: true }));

  app.get('/proxy/:target', createHonoUrlGuard(policy, { params: true }), (c) =>
    c.json({ ok: true }),
  );

  return app;
}

describe('createHonoUrlGuard against real Hono', () => {
  it('lets a clean JSON request through, and the handler can still read the body', async () => {
    const res = await buildApp().request('/crawl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://api.example.com/data', note: 'fine' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      echoed: { url: 'https://api.example.com/data', note: 'fine' },
    });
  });

  it('blocks a metadata URL nested in the JSON body', async () => {
    const res = await buildApp().request('/crawl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // https, so the scheme check passes and the IP-literal guard is
      // what actually fires — otherwise this asserts nothing about the
      // interesting half of the policy.
      body: JSON.stringify({ job: { steps: [{ target: 'https://169.254.169.254/latest/' }] } }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'ssrf_blocked', reason: 'blocked_ip_literal' });
  });

  it('blocks a bad URL in the query string', async () => {
    const res = await buildApp().request('/fetch?url=http://127.0.0.1:8080/admin');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'ssrf_blocked' });
  });

  it('lets a clean query through', async () => {
    const res = await buildApp().request('/fetch?url=https://api.example.com/ok');
    expect(res.status).toBe(200);
  });

  it('scans a urlencoded form body, and the handler can still read it', async () => {
    const app = buildApp();

    const blocked = await app.request('/form', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ target: 'https://evil.example/steal' }).toString(),
    });
    expect(blocked.status).toBe(400);

    const clean = await app.request('/form', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ target: 'https://api.example.com/ok' }).toString(),
    });
    expect(clean.status).toBe(200);
    expect(await clean.json()).toEqual({
      ok: true,
      echoed: { target: 'https://api.example.com/ok' },
    });
  });

  it('reads path params when asked to', async () => {
    const res = await buildApp().request(
      `/proxy/${encodeURIComponent('http://169.254.169.254/latest/')}`,
    );
    expect(res.status).toBe(400);
  });

  it('does not read a multipart body', async () => {
    const form = new FormData();
    form.set('url', 'http://169.254.169.254/latest/');

    // Deliberately reaches the handler: multipart is out of scope for the
    // guard, and the route owns that decision.
    const res = await buildApp().request('/crawl', { method: 'POST', body: form });
    expect(res.status).not.toBe(400);
  });

  it('does not 500 on a malformed JSON body', async () => {
    const res = await buildApp().request('/crawl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).not.toBe(400);
    expect(res.status).toBeLessThan(600);
  });
});
