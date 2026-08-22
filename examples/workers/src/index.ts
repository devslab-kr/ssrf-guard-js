import {
  checkUrl,
  guardedFetch,
  guardToolInputJson,
  sameSitePolicy,
  singleHostPolicy,
  SsrfGuardError,
  type FetchImpl,
} from '@devslab/ssrf-guard-js';
import { createHonoUrlGuard } from '@devslab/ssrf-guard-js/hono';
import { Hono, type Context } from 'hono';

/**
 * SSRF defence on Cloudflare Workers, using the half of
 * `@devslab/ssrf-guard-js` that works without DNS.
 *
 * The JVM demos in this repo all guard a Spring HTTP client. This one is
 * the edge story: on Workers there is no usable `dns.lookup`, and even if
 * there were, `fetch` resolves the host itself — so a userland DNS check
 * cannot be pinned to the socket that actually connects. `safeFetch`
 * therefore refuses to run here, deliberately and with a pointer to
 * `guardedFetch`, rather than degrading into a weaker check that looks
 * like the same call.
 *
 * What still holds on Workers: URL-time validation, per-hop redirect
 * revalidation, credential stripping, response-size caps, and the
 * tool-input scanner. The allowlist is doing the load-bearing work.
 */

const REGISTERED_API = 'https://api.example.com:8443/v1';

export interface Env {
  /** Injected in tests so the demo runs without network access. */
  FETCH?: FetchImpl;
}

export const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) =>
  c.json({
    demo: 'ssrf-guard-js on Cloudflare Workers',
    endpoints: {
      'POST /crawl': 'guardedFetch + sameSitePolicy — fetch a page of the site you submit',
      'POST /api-call': 'singleHostPolicy — call one registered endpoint and nowhere else',
      'POST /tool-input': 'guardToolInputJson — scan LLM tool arguments for hidden URLs',
      'GET  /attack-matrix': 'checkUrl over a table of known SSRF payloads',
    },
    note: 'safeFetch is unavailable on Workers by design — see GET /why-no-safe-fetch',
  }),
);

/**
 * The middleware form. Every URL in the body or query is checked against a
 * FIXED allowlist before the handler runs, and a violation never reaches
 * the handler at all.
 */
app.post(
  '/api-call',
  createHonoUrlGuard(singleHostPolicy(REGISTERED_API)),
  async (c) => {
    const { path } = await c.req.json<{ path?: string }>();
    const target = new URL(path ?? '/status', REGISTERED_API).toString();

    try {
      const res = await guardedFetch(target, singleHostPolicy(REGISTERED_API), {
        fetchImpl: c.env.FETCH,
        maxBytes: 64 * 1024,
        maxRedirects: 2,
      });
      return c.json({ ok: true, status: res.status, body: (await res.text()).slice(0, 200) });
    } catch (e) {
      return blocked(c, e);
    }
  },
);

/**
 * The per-request form. There is no fixed allowlist here — the policy is
 * DERIVED from what the user submitted, which is why the middleware above
 * cannot express this route: a static allowlist would reject every
 * submission, and a permissive one would assert a safety property it does
 * not have.
 */
app.post('/crawl', async (c) => {
  const { url } = await c.req.json<{ url?: string }>();
  if (!url) return c.json({ error: 'url required' }, 400);

  // Lock the whole fetch — redirects included — to the submitted domain.
  const policy = sameSitePolicy(url, { allowedSchemes: ['https'] });
  let finalUrl: URL | undefined;

  try {
    const res = await guardedFetch(url, policy, {
      fetchImpl: c.env.FETCH,
      maxRedirects: 5,
      // A cap that stops the transfer, not one applied after the body
      // already arrived.
      maxBytes: 2_000_000,
      onFinalUrl: (u) => {
        finalUrl = u;
      },
    });
    const body = await res.text();
    return c.json({
      ok: true,
      // The guard's own report of where the content came from. More
      // reliable than Response.url, which some fetch impls leave empty.
      fetchedFrom: finalUrl?.toString() ?? null,
      status: res.status,
      length: body.length,
    });
  } catch (e) {
    return blocked(c, e);
  }
});

/** LLM tool arguments: the URL can be anywhere in the JSON, including prose. */
app.post('/tool-input', async (c) => {
  const raw = await c.req.text();
  const violation = guardToolInputJson(
    raw,
    { exactHosts: ['api.example.com'], allowedSchemes: ['https'] },
    // Catch URLs buried mid-sentence, not just whole-string values.
    { scanEmbedded: true },
  );
  return violation
    ? c.json({ allowed: false, toolResult: JSON.parse(violation) }, 400)
    : c.json({ allowed: true });
});

/**
 * The payload table the JVM demos also carry, answered with `checkUrl` —
 * the non-throwing form, so one bad entry does not end the report.
 */
const PAYLOADS: Array<[string, string]> = [
  ['https://api.example.com/v1/ok', 'right host, DEFAULT port — singleHostPolicy locked 8443'],
  ['https://api.example.com:8443/v1/ok', 'the registered origin — the only thing allowed'],
  ['http://api.example.com/v1', 'scheme not allowed'],
  ['https://evil.example/steal', 'host not in the allowlist'],
  ['https://sub.api.example.com/', 'subdomain — allowed by suffix policies, not by this one'],
  ['https://169.254.169.254/latest/meta-data/', 'cloud metadata, IP literal'],
  ['http://[fd00::1]/', 'IPv6 unique-local literal'],
  ['http://[::]/', 'IPv6 unspecified — reaches the local host'],
  ['http://[fec0::1]/', 'IPv6 site-local, deprecated but still routed'],
  ['http://2130706433/', 'decimal-encoded 127.0.0.1'],
  ['http://0x7f000001/', 'hex-encoded 127.0.0.1'],
  ['http://127.1/', 'shortened loopback'],
  ['https://user:pass@api.example.com/', 'userinfo in the URL'],
  ['//evil.example/x', 'protocol-relative — inherits the caller scheme'],
  ['file:///etc/passwd', 'non-http scheme'],
  ['gopher://evil.example/', 'non-http scheme'],
  ['not a url', 'unparseable'],
];

app.get('/attack-matrix', (c) => {
  const policy = singleHostPolicy(REGISTERED_API);
  return c.json({
    policy: { origin: REGISTERED_API, note: 'scheme + host + port, nothing else' },
    results: PAYLOADS.map(([url, why]) => {
      const result = checkUrl(url, policy);
      return {
        url,
        note: why,
        allowed: result.allowed,
        reason: result.allowed ? null : result.error.reason,
      };
    }),
  });
});

/**
 * Only meaningful on the real Workers runtime. The test suite runs on
 * Node, where `node:dns` exists and `safeFetch` gets as far as an actual
 * lookup — so the tests assert the response SHAPE and leave the
 * runtime-specific reason to a deployed Worker.
 */
app.get('/why-no-safe-fetch', async (c) => {
  const { safeFetch } = await import('@devslab/ssrf-guard-js');
  try {
    await safeFetch(`${REGISTERED_API}/status`, singleHostPolicy(REGISTERED_API));
    return c.json({ ran: true, note: 'unexpected on Workers' });
  } catch (e) {
    return c.json({
      ran: false,
      // A typed error pointing at guardedFetch, not a crash and not a
      // silently weaker check.
      reason: e instanceof SsrfGuardError ? e.reason : 'unknown',
      message: e instanceof Error ? e.message : String(e),
    });
  }
});

function blocked(c: Context<{ Bindings: Env }>, e: unknown) {
  if (e instanceof SsrfGuardError) {
    return c.json({ ok: false, blocked: true, reason: e.reason, message: e.message }, 400);
  }
  return c.json({ ok: false, blocked: false, message: e instanceof Error ? e.message : 'failed' }, 502);
}

export default app;
