import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { safeFetch, SsrfGuardError, UrlPolicy } from '../src/index.js';

// Integration tests for DNS-pinned mode: real undici (devDependency), real DNS
// resolution of localhost, and a real local HTTP server.

let server: Server;
let port: number;

function pinnedPolicy(overrides: Partial<ConstructorParameters<typeof UrlPolicy>[0]> = {}): UrlPolicy {
  return new UrlPolicy({
    exactHosts: ['localhost'],
    allowedSchemes: ['http'],
    allowedPorts: [port],
    blockPrivateNetworks: false,
    ...overrides,
  });
}

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
        res.end(`pinned ok:${req.url}`);
      });
      server.listen(0, () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    }),
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('safeFetch with DNS pinning', () => {
  it('fetches through the pinned connector when pinDns is true', async () => {
    const response = await safeFetch(`http://localhost:${port}/data`, pinnedPolicy(), {
      pinDns: true,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('pinned ok:/data');
  });

  it('pins automatically when undici is available and pinDns is unset', async () => {
    const response = await safeFetch(`http://localhost:${port}/auto`, pinnedPolicy());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('pinned ok:/auto');
  });

  it('follows redirects through the pinned connector', async () => {
    const response = await safeFetch(`http://localhost:${port}/redirect`, pinnedPolicy(), {
      pinDns: true,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('pinned ok:/target');
  });

  it('blocks private addresses at connect time and surfaces SsrfGuardError', async () => {
    // localhost resolves to loopback, which is private - the validating lookup
    // inside the connector must reject before any socket is opened.
    await expect(
      safeFetch(
        `http://localhost:${port}/data`,
        pinnedPolicy({ blockPrivateNetworks: true }),
        { pinDns: true },
      ),
    ).rejects.toSatisfy(
      (error) => error instanceof SsrfGuardError && error.reason === 'blocked_private_ip',
    );
  });

  it('reuses the pinned agent across calls with the same UrlPolicy instance', async () => {
    const policy = pinnedPolicy();

    const first = await safeFetch(`http://localhost:${port}/one`, policy, { pinDns: true });
    const second = await safeFetch(`http://localhost:${port}/two`, policy, { pinDns: true });

    expect(await first.text()).toBe('pinned ok:/one');
    expect(await second.text()).toBe('pinned ok:/two');
  });
});
