import { describe, expect, it, vi } from 'vitest';
import { createHonoUrlGuard } from '../src/hono.js';
import type { MinimalHonoContext } from '../src/hono.js';

const policy = { exactHosts: ['api.example.com'], allowedSchemes: ['https'] };

interface FakeInit {
  query?: Record<string, string>;
  params?: Record<string, string>;
  contentType?: string;
  json?: unknown;
  form?: unknown;
  /** Make the body parser throw, as Hono does on a malformed body. */
  bodyThrows?: boolean;
}

function fakeContext(init: FakeInit = {}) {
  const jsonCalls = { count: 0 };
  const formCalls = { count: 0 };
  const responses: Array<{ body: unknown; status: number | undefined }> = [];

  const c: MinimalHonoContext = {
    req: {
      query: () => init.query ?? {},
      param: () => init.params ?? {},
      header: (name) => (name.toLowerCase() === 'content-type' ? init.contentType : undefined),
      json: async () => {
        jsonCalls.count += 1;
        if (init.bodyThrows) throw new SyntaxError('bad json');
        return init.json;
      },
      parseBody: async () => {
        formCalls.count += 1;
        if (init.bodyThrows) throw new Error('bad form');
        return init.form;
      },
    },
    json: (body, status) => {
      responses.push({ body, status });
      return new Response(JSON.stringify(body), { status: status ?? 200 });
    },
  };

  return { c, responses, jsonCalls, formCalls };
}

describe('createHonoUrlGuard', () => {
  it('passes a clean request to the handler', async () => {
    const { c } = fakeContext({ query: { url: 'https://api.example.com/data' } });
    const next = vi.fn(async () => {});
    const res = await createHonoUrlGuard(policy)(c, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res).toBeUndefined();
  });

  it('blocks a metadata URL in the query and never calls the handler', async () => {
    const { c, responses } = fakeContext({
      query: { url: 'http://169.254.169.254/latest/meta-data/' },
    });
    const next = vi.fn(async () => {});
    const res = await createHonoUrlGuard(policy)(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(res).toBeInstanceOf(Response);
    expect(responses[0]?.status).toBe(400);
    expect(responses[0]?.body).toMatchObject({ error: 'ssrf_blocked' });
  });

  it('walks a nested JSON body', async () => {
    const { c, responses } = fakeContext({
      contentType: 'application/json',
      json: { outer: { note: 'see below', items: [{ target: 'https://evil.example/steal' }] } },
    });
    const next = vi.fn(async () => {});
    await createHonoUrlGuard(policy)(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(responses[0]?.body).toMatchObject({ error: 'ssrf_blocked' });
  });

  it('accepts a +json content type', async () => {
    const { c, jsonCalls } = fakeContext({
      contentType: 'application/vnd.api+json; charset=utf-8',
      json: { url: 'https://api.example.com/ok' },
    });
    await createHonoUrlGuard(policy)(c, vi.fn(async () => {}));
    expect(jsonCalls.count).toBe(1);
  });

  it('scans urlencoded form bodies', async () => {
    const { c, responses, formCalls } = fakeContext({
      contentType: 'application/x-www-form-urlencoded',
      form: { target: 'http://127.0.0.1:8080/admin' },
    });
    await createHonoUrlGuard(policy)(c, vi.fn(async () => {}));

    expect(formCalls.count).toBe(1);
    expect(responses[0]?.body).toMatchObject({ error: 'ssrf_blocked' });
  });

  // Documented gap, pinned as a test so it stays a decision rather than
  // drifting into an accident: parsing multipart here would buffer
  // uploads inside a guard that runs on every request.
  it('does not read multipart bodies', async () => {
    const { c, jsonCalls, formCalls } = fakeContext({
      contentType: 'multipart/form-data; boundary=xyz',
    });
    const next = vi.fn(async () => {});
    await createHonoUrlGuard(policy)(c, next);

    expect(jsonCalls.count).toBe(0);
    expect(formCalls.count).toBe(0);
    expect(next).toHaveBeenCalledOnce();
  });

  it('leaves an unparseable body to the handler instead of 500ing', async () => {
    const { c } = fakeContext({ contentType: 'application/json', bodyThrows: true });
    const next = vi.fn(async () => {});
    await expect(createHonoUrlGuard(policy)(c, next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('fails closed on an empty policy', async () => {
    const { c, responses } = fakeContext({ query: { url: 'https://anywhere.example/' } });
    await createHonoUrlGuard({})(c, vi.fn(async () => {}));
    expect(responses[0]?.body).toMatchObject({ error: 'ssrf_blocked' });
  });

  it('honours the body/query/params switches', async () => {
    const bad = { url: 'https://evil.example/steal' };

    const noQuery = fakeContext({ query: bad });
    await createHonoUrlGuard(policy, { query: false })(noQuery.c, vi.fn(async () => {}));
    expect(noQuery.responses).toHaveLength(0);

    const noBody = fakeContext({ contentType: 'application/json', json: bad });
    await createHonoUrlGuard(policy, { body: false })(noBody.c, vi.fn(async () => {}));
    expect(noBody.jsonCalls.count).toBe(0);

    const withParams = fakeContext({ params: bad });
    await createHonoUrlGuard(policy, { params: true })(withParams.c, vi.fn(async () => {}));
    expect(withParams.responses[0]?.body).toMatchObject({ error: 'ssrf_blocked' });
  });

  it('uses a custom status code', async () => {
    const { c, responses } = fakeContext({ query: { url: 'https://evil.example/' } });
    await createHonoUrlGuard(policy, { statusCode: 422 })(c, vi.fn(async () => {}));
    expect(responses[0]?.status).toBe(422);
  });
});
