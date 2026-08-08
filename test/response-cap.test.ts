import { describe, expect, it, vi } from 'vitest';
import { guardedFetch } from '../src/index.js';
import type { FetchImpl } from '../src/index.js';

const policy = { exactHosts: ['api.example.com', 'cdn.example.com'], allowedSchemes: ['https'] };

function scriptedFetch(responses: Response[]): FetchImpl & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const impl: FetchImpl = async (url) => {
    calls.push(url.toString());
    const res = responses[i++];
    if (!res) throw new Error('no more scripted responses');
    return res;
  };
  return Object.assign(impl, { calls });
}

/**
 * A body that is produced only as it is pulled, so "the transfer stopped"
 * is observable: an eagerly-enqueued stream would have handed over every
 * byte before the cap ever ran.
 */
function lazyBody(chunkCount: number, chunkSize: number, headers: Record<string, string> = {}) {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunkCount) {
        controller.close();
        return;
      }
      pulled += 1;
      controller.enqueue(new Uint8Array(chunkSize).fill(97));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream, { status: 200, headers }),
    pulled: () => pulled,
    cancelled: () => cancelled,
  };
}

describe('maxBytes', () => {
  it('passes a body under the cap through untouched', async () => {
    const fetchImpl = scriptedFetch([new Response('hello')]);
    const res = await guardedFetch('https://api.example.com/data', policy, {
      fetchImpl,
      maxBytes: 1024,
    });
    expect(await res.text()).toBe('hello');
  });

  it('rejects on Content-Length before reading a byte', async () => {
    const body = lazyBody(10, 64, { 'content-length': '640' });
    const fetchImpl = scriptedFetch([body.response]);

    await expect(
      guardedFetch('https://api.example.com/big', policy, { fetchImpl, maxBytes: 100 }),
    ).rejects.toMatchObject({ reason: 'blocked_response_size' });

    // The claim is that guardedFetch itself rejects — no read needed to
    // find out. The runtime may prime a single chunk when the Response is
    // constructed, so what matters is that the body was not drained.
    expect(body.pulled()).toBeLessThan(10);
    expect(body.cancelled()).toBe(true);
  });

  it('rejects mid-stream when there is no Content-Length', async () => {
    const body = lazyBody(10, 64);
    const fetchImpl = scriptedFetch([body.response]);
    const res = await guardedFetch('https://api.example.com/stream', policy, {
      fetchImpl,
      maxBytes: 100,
    });

    await expect(res.text()).rejects.toMatchObject({ reason: 'blocked_response_size' });
    expect(body.pulled()).toBeLessThan(10);
    expect(body.cancelled()).toBe(true);
  });

  // A Content-Length that fits the cap is not a promise. The streaming
  // count is what makes the cap a control rather than a courtesy.
  it('rejects mid-stream when Content-Length understates the body', async () => {
    const body = lazyBody(10, 64, { 'content-length': '10' });
    const fetchImpl = scriptedFetch([body.response]);
    const res = await guardedFetch('https://api.example.com/liar', policy, {
      fetchImpl,
      maxBytes: 100,
    });

    await expect(res.text()).rejects.toMatchObject({ reason: 'blocked_response_size' });
  });

  it('never truncates silently — an oversized read fails, it does not shorten', async () => {
    const fetchImpl = scriptedFetch([new Response('0123456789')]);
    const res = await guardedFetch('https://api.example.com/data', policy, {
      fetchImpl,
      maxBytes: 4,
    });
    await expect(res.text()).rejects.toMatchObject({ reason: 'blocked_response_size' });
  });

  it('treats maxBytes: 0 as "no body at all"', async () => {
    const empty = scriptedFetch([new Response('')]);
    const emptyRes = await guardedFetch('https://api.example.com/empty', policy, {
      fetchImpl: empty,
      maxBytes: 0,
    });
    expect(await emptyRes.text()).toBe('');

    const nonEmpty = scriptedFetch([new Response('x')]);
    const res = await guardedFetch('https://api.example.com/data', policy, {
      fetchImpl: nonEmpty,
      maxBytes: 0,
    });
    await expect(res.text()).rejects.toMatchObject({ reason: 'blocked_response_size' });
  });

  it('returns null-body responses as they are', async () => {
    const fetchImpl = scriptedFetch([new Response(null, { status: 204 })]);
    const res = await guardedFetch('https://api.example.com/nothing', policy, {
      fetchImpl,
      maxBytes: 0,
    });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('caps the final response, not the redirect hops it discards', async () => {
    const hop = new Response('x'.repeat(500), {
      status: 302,
      headers: { location: 'https://cdn.example.com/small', 'content-length': '500' },
    });
    const fetchImpl = scriptedFetch([hop, new Response('small')]);

    const res = await guardedFetch('https://api.example.com/go', policy, {
      fetchImpl,
      maxBytes: 100,
    });
    expect(await res.text()).toBe('small');
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('does not call onFinalUrl when the declared length is blocked', async () => {
    const onFinalUrl = vi.fn();
    const fetchImpl = scriptedFetch([
      new Response('x'.repeat(500), { headers: { 'content-length': '500' } }),
    ]);

    await expect(
      guardedFetch('https://api.example.com/big', policy, { fetchImpl, maxBytes: 10, onFinalUrl }),
    ).rejects.toMatchObject({ reason: 'blocked_response_size' });
    expect(onFinalUrl).not.toHaveBeenCalled();
  });

  // A cap silently disabled by a bad env parse is the failure this guards.
  it.each([Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects maxBytes: %s before making a request',
    async (value) => {
      const fetchImpl = scriptedFetch([new Response('ok')]);
      await expect(
        guardedFetch('https://api.example.com/data', policy, { fetchImpl, maxBytes: value }),
      ).rejects.toThrow(TypeError);
      expect(fetchImpl.calls).toHaveLength(0);
    },
  );

  it('leaves responses alone when maxBytes is unset', async () => {
    const fetchImpl = scriptedFetch([new Response('x'.repeat(10_000))]);
    const res = await guardedFetch('https://api.example.com/data', policy, { fetchImpl });
    expect((await res.text()).length).toBe(10_000);
  });
});
