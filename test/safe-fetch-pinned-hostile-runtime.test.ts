import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Simulates a runtime that accepts undici's `Agent({ connect: { lookup } })`
// and then never calls the hook — which is what Bun 1.3.3 does. Node honours
// it, so every existing pinned test passes there while the same code silently
// performs zero DNS checks on Bun.
//
// The stub deliberately drops both the lookup hook and the dispatcher, so the
// only thing that can block a private address is the pre-connect check in
// safeFetch itself. Before this was fixed, safeFetch skipped that check
// whenever undici was loadable, and this file's tests fetched loopback.
const lookupCalls: string[] = [];

vi.mock('undici', () => {
  class Agent {
    constructor(options: { connect?: { lookup?: unknown } } = {}) {
      // Accept the option, record that we were given one, ignore it entirely.
      if (options.connect?.lookup) lookupCalls.push('handed a lookup, ignoring it');
    }
  }
  return {
    Agent,
    fetch: (url: string | URL, init: Record<string, unknown> = {}) => {
      const { dispatcher: _dispatcher, ...rest } = init;
      return globalThis.fetch(url, rest as RequestInit);
    },
  };
});

const { safeFetch, SsrfGuardError, UrlPolicy } = await import('../src/index.js');

let server: Server;
let port: number;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url === '/redirect') {
          res.writeHead(302, { location: `http://localhost:${port}/target` });
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`reached:${req.url}`);
      });
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    }),
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function policy() {
  return new UrlPolicy({
    exactHosts: ['localhost'],
    allowedSchemes: ['http'],
    allowedPorts: [port],
    blockPrivateNetworks: true,
  });
}

const isPrivateIpBlock = (error: unknown) =>
  error instanceof SsrfGuardError && error.reason === 'blocked_private_ip';

describe('safeFetch on a runtime that ignores undici connect.lookup', () => {
  it('still blocks a private address with pinDns: true', async () => {
    await expect(
      safeFetch(`http://localhost:${port}/data`, policy(), { pinDns: true }),
    ).rejects.toSatisfy(isPrivateIpBlock);
  });

  it('still blocks a private address when pinning is automatic', async () => {
    // pinDns unset + undici loadable is the default path, so this is what a
    // Bun user got without opting into anything.
    await expect(
      safeFetch(`http://localhost:${port}/data`, policy()),
    ).rejects.toSatisfy(isPrivateIpBlock);
  });

  it('still blocks a private address on a redirect hop', async () => {
    await expect(
      safeFetch(`http://localhost:${port}/redirect`, policy(), { pinDns: true }),
    ).rejects.toSatisfy(isPrivateIpBlock);
  });

  it('confirms the stub was actually handed a lookup hook it ignored', () => {
    // Guards the test itself: if the hook stopped being passed, these tests
    // would pass for the wrong reason.
    expect(lookupCalls.length).toBeGreaterThan(0);
  });
});
