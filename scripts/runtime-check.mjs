// Runs the built package on whichever runtime is executing this file.
//
// The unit suite runs on Node only. That is enough for logic, but not for
// guarantees that depend on a host honouring a hook: JS-016 was a bypass that
// every Node test passed straight through, because Node calls undici's
// `connect.lookup` and Bun does not. This script exercises the built `dist/`
// where the runtime differences actually live.
//
//   node  scripts/runtime-check.mjs
//   bun   scripts/runtime-check.mjs
//   deno  run -A scripts/runtime-check.mjs
//
// Exits non-zero on the first failed expectation, so CI treats a runtime that
// stops enforcing a check as a build failure.

import { createServer } from 'node:http';

const dist = new URL('../dist/index.mjs', import.meta.url).href;
const { validateUrl, checkUrl, guardedFetch, safeFetch, guardToolInputJson, SsrfGuardError } =
  await import(dist);

const runtime =
  typeof Deno !== 'undefined'
    ? `deno ${Deno.version.deno}`
    : typeof Bun !== 'undefined'
      ? `bun ${Bun.version}`
      : `node ${process.version}`;

let failures = 0;
const pass = (name, note = '') => console.log(`  ok    ${name}${note ? ` — ${note}` : ''}`);
const fail = (name, detail) => {
  failures++;
  console.log(`  FAIL  ${name}\n        ${detail}`);
};

async function expectBlocked(name, run, reason) {
  try {
    const response = await run();
    fail(name, `not blocked — got HTTP ${response?.status ?? '(no error thrown)'}`);
  } catch (error) {
    const actual = error?.reason ?? error?.cause?.reason;
    if (actual === reason) pass(name, reason);
    else fail(name, `blocked, but reason was ${actual ?? `untyped: ${error?.message}`}`);
  }
}

console.log(`\n=== ssrf-guard-js runtime check — ${runtime} ===\n`);

// --- URL-time surface, no network -------------------------------------------
const policy = {
  exactHosts: ['api.example.com'],
  allowedSchemes: ['https'],
  allowedPorts: [-1, 443],
};

try {
  const url = validateUrl('https://api.example.com/v1', policy);
  if (url.href === 'https://api.example.com/v1') pass('validateUrl allows an allowlisted host');
  else fail('validateUrl allows an allowlisted host', `href was ${url.href}`);
} catch (error) {
  fail('validateUrl allows an allowlisted host', error.message);
}

await expectBlocked(
  'validateUrl rejects an IP literal',
  async () => validateUrl('https://169.254.169.254/latest/meta-data/', policy),
  'blocked_ip_literal',
);

// domainToASCII lives behind a static `node:url` import — the one Node builtin
// on the runs-anywhere path, so it is worth proving per runtime.
try {
  const url = validateUrl('https://bücher.example/', {
    exactHosts: ['xn--bcher-kva.example'],
    allowedSchemes: ['https'],
  });
  if (url.hostname === 'xn--bcher-kva.example') pass('IDNA host normalization', url.hostname);
  else fail('IDNA host normalization', `hostname was ${url.hostname}`);
} catch (error) {
  fail('IDNA host normalization', error.message);
}

if (checkUrl('http://10.0.0.1/', policy).allowed === false) pass('checkUrl reports a private IP');
else fail('checkUrl reports a private IP', 'allowed was true');

if (guardToolInputJson(JSON.stringify({ r: { t: 'http://169.254.169.254/' } }), policy))
  pass('guardToolInputJson catches a nested URL');
else fail('guardToolInputJson catches a nested URL', 'no violation reported');

// --- guardedFetch, with an injected fetch so no network is needed ------------
let reached = false;
await expectBlocked(
  // https, not http: the policy allows only https, and a scheme rejection
  // would short-circuit before the IP-literal check this is meant to prove.
  'guardedFetch blocks before issuing the request',
  () =>
    guardedFetch('https://169.254.169.254/', policy, {
      fetchImpl: () => {
        reached = true;
        return new Response('should never be reached');
      },
    }),
  'blocked_ip_literal',
);
if (reached) fail('guardedFetch blocks before issuing the request', 'fetchImpl was still called');

await expectBlocked(
  'maxBytes rejects an oversized Content-Length',
  () =>
    guardedFetch('https://api.example.com/d', policy, {
      maxBytes: 10,
      fetchImpl: async () => new Response('x'.repeat(100), { headers: { 'content-length': '100' } }),
    }),
  'blocked_response_size',
);

// --- safeFetch DNS enforcement, against a real loopback listener ------------
// This is the JS-016 regression. `localhost` is allowlisted by host, so the
// only thing that can stop the fetch is the DNS check noticing it resolves to
// a loopback address. A runtime that skips that check reaches the server and
// gets an HTTP 200 instead of an error.
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('reached a private address');
});

const port = await new Promise((resolve, reject) => {
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

try {
  // Guard against a vacuous pass: if the listener is unreachable, every
  // safeFetch below would "block" for the wrong reason and the check would be
  // worthless. Prove reachability with the literal IP first.
  const probe = await fetch(`http://127.0.0.1:${port}/`);
  if (probe.status === 200) pass('loopback listener is reachable', 'blocks below are meaningful');
  else fail('loopback listener is reachable', `probe returned HTTP ${probe.status}`);
  await probe.text();

  // Equally vacuous if undici is absent: the pinned modes would fail with
  // "undici not installed" rather than exercising the connector path at all.
  let undiciInstalled = false;
  try {
    await import('undici');
    undiciInstalled = true;
  } catch {
    /* recorded below */
  }
  if (undiciInstalled) pass('undici is installed', 'pinned modes are genuinely exercised');
  else fail('undici is installed', 'pinned modes below cannot exercise the connector path');

  const dnsPolicy = {
    exactHosts: ['localhost'],
    allowedSchemes: ['http'],
    allowedPorts: [port],
  };

  // false = check-then-fetch · unset = auto-pin when undici is present · true = require pinning
  for (const pinDns of [false, undefined, true]) {
    await expectBlocked(
      `safeFetch blocks a host resolving to loopback (pinDns=${pinDns})`,
      () => safeFetch(`http://localhost:${port}/`, dnsPolicy, { pinDns }),
      'blocked_private_ip',
    );
  }

  if (typeof SsrfGuardError !== 'function') fail('SsrfGuardError is exported', 'not a constructor');
  else pass('SsrfGuardError is exported');

  // The secondary entry points are separate files in dist/, so "the package
  // loads" says nothing about them. The Hono guard in particular targets the
  // non-Node runtimes, which is exactly where an entry point that resolves on
  // Node can still fail to resolve.
  try {
    const { createHonoUrlGuard } = await import(new URL('../dist/hono.mjs', import.meta.url).href);
    if (typeof createHonoUrlGuard !== 'function') {
      fail('./hono entry point loads', 'createHonoUrlGuard is not a function');
    } else {
      // Drive it once, so this checks the middleware runs here rather than
      // merely that the file parsed.
      let handlerRan = false;
      let blocked = null;
      const guard = createHonoUrlGuard({ exactHosts: ['api.example.com'] });
      await guard(
        {
          req: {
            query: () => ({ url: 'http://169.254.169.254/latest/meta-data/' }),
            param: () => ({}),
            header: () => undefined,
            json: async () => ({}),
            parseBody: async () => ({}),
          },
          json: (body, status) => {
            blocked = { body, status };
            return new Response(JSON.stringify(body), { status });
          },
        },
        async () => {
          handlerRan = true;
        },
      );

      if (handlerRan || blocked?.body?.error !== 'ssrf_blocked') {
        fail('./hono guard blocks a metadata URL', `handlerRan=${handlerRan} body=${JSON.stringify(blocked?.body)}`);
      } else {
        pass('./hono guard blocks a metadata URL', `HTTP ${blocked.status}`);
      }
    }
  } catch (error) {
    fail('./hono entry point loads', String(error));
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(
  failures === 0
    ? `\n${runtime}: all checks passed\n`
    : `\n${runtime}: ${failures} check(s) FAILED\n`,
);

if (failures > 0) {
  if (typeof Deno !== 'undefined') Deno.exit(1);
  else process.exit(1);
}
