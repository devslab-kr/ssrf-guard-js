# ssrf-guard-js

[![npm](https://img.shields.io/npm/v/%40devslab%2Fssrf-guard-js)](https://www.npmjs.com/package/@devslab/ssrf-guard-js)
[![CI](https://github.com/devslab-kr/ssrf-guard-js/actions/workflows/ci.yml/badge.svg)](https://github.com/devslab-kr/ssrf-guard-js/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?logo=typescript&logoColor=white)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

**[Docs](https://devslab-kr.github.io/ssrf-guard-js/)** · [Roadmap](docs/roadmap.md) · [Decisions](docs/decisions.md) · [한국어](README.ko.md)

SSRF protection for JavaScript and TypeScript.

This is the JS/TS sibling of [`devslab-kr/ssrf-guard`](https://github.com/devslab-kr/ssrf-guard).
It ports the same core security model:

- URL-time validation: scheme, host allowlist, port, userinfo, IP-literal checks
- private-network IP classification
- LLM/tool-call JSON scanning for hidden URLs
- guarded fetch with URL, DNS, and redirect checks

## Install

```bash
pnpm add @devslab/ssrf-guard-js
```

For a copy-paste tutorial, see the documentation site:
https://devslab-kr.github.io/ssrf-guard-js/

## URL Policy

```ts
import { validateUrl } from '@devslab/ssrf-guard-js';

validateUrl('https://api.example.com/v1', {
  exactHosts: ['api.example.com'],
  allowedSchemes: ['https'],
  allowedPorts: [-1, 443],
});
```

Empty `exactHosts` and `suffixes` are fail-closed: no host is allowed until
you configure one.

`validateUrl` throws. For the decisions that surround a fetch — which links
a crawler enqueues, which of a batch of URLs to report as rejected — ask
without exceptions:

```ts
import { checkUrl, isUrlAllowed } from '@devslab/ssrf-guard-js';

const result = checkUrl(link, policy);
if (!result.allowed) log.debug(`skipped ${link}: ${result.error.reason}`);

const crawlable = links.filter((link) => isUrlAllowed(link, policy));
```

Both run the same code path as `validateUrl`, so the answer always agrees
with what the fetch guards would do — which a hand-written host comparison
does not. This is a URL-time answer only: `safeFetch`'s DNS checks have no
non-throwing equivalent, because knowing that requires actually resolving.

Defaults:

- `allowedSchemes`: `['http', 'https']`
- `allowedPorts`: `[-1, 80, 443]` — URLs without an explicit port count as the
  scheme's default port (`http`/`ws` → `80`, `https`/`wss` → `443`), so
  `allowedPorts: [443]` alone is enough for HTTPS-only policies. `-1` matches
  portless URLs of schemes without a known default.
- `rejectIpLiteralHosts`: `true`
- `rejectUserInfo`: `true`
- `blockPrivateNetworks`: `true`

## LLM Tool Input Guard

```ts
import { guardToolInputJson } from '@devslab/ssrf-guard-js';

const violation = guardToolInputJson(
  JSON.stringify({ request: { target: 'http://169.254.169.254/latest/meta-data/' } }),
  { exactHosts: ['api.example.com'] },
);

if (violation) {
  return violation; // structured JSON error for the model/tool caller
}
```

The guard walks the entire JSON tree. A bad URL hidden inside a nested object,
array, or explanation field is still blocked. The scanner collects any
`scheme://` URL (the policy's `allowedSchemes` decides the outcome, so
`file://` or `gopher://` are rejected by default) and protocol-relative
`//host` strings, which are validated against the host policy.

By default only strings whose whole (trimmed) value is a URL are flagged,
wherever they sit in the tree. To also catch URLs buried mid-sentence inside
longer strings — `"summarize http://169.254.169.254/ please"` — opt into
embedded scanning:

```ts
guardToolInputJson(toolInput, policy, { scanEmbedded: true });
```

`scanEmbedded` is strictly additive (everything the base scanner flags stays
flagged) and deliberately aggressive: URL-shaped text inside prose or code
snippets is validated against the policy, so non-allowlisted hosts there
count as violations. Prose punctuation stuck to the URL tail
(`…see https://spec.example/docs,`) is trimmed before validation.

## Guarded Fetch

```ts
import { safeFetch } from '@devslab/ssrf-guard-js';

const response = await safeFetch('https://api.example.com/data', {
  exactHosts: ['api.example.com'],
  allowedSchemes: ['https'],
});
```

`safeFetch` validates the URL, checks DNS results for private/local IPs
(failing closed if any resolved address is private), and revalidates every
redirect hop. On cross-origin redirects it strips `Authorization`,
`Proxy-Authorization`, and `Cookie` headers, and it downgrades `303` (and
`301`/`302` `POST`) redirects to `GET` without replaying the request body.

Both `safeFetch` and `guardedFetch` accept an `onFinalUrl` callback that
receives the final validated URL once all redirect hops have been followed.
Use it to attribute the fetched content to its true origin — it is more
reliable than `Response.url`, which some fetch implementations (including
custom `fetchImpl`s) leave empty. It is not called when the fetch throws.

```ts
let finalUrl: URL | undefined;
const response = await safeFetch(input, policy, {
  onFinalUrl: (url) => {
    finalUrl = url;
  },
});
```

### Response size cap

Both also accept `maxBytes`, so a response that streams without end cannot
exhaust the caller:

```ts
const res = await guardedFetch(url, policy, { maxBytes: 2_000_000 });
const body = await res.text(); // rejects if the body runs past the cap
```

It is checked twice, because either alone is insufficient: an oversized
`Content-Length` is rejected before a byte is read, and a streaming count
catches bodies that omit or understate it.

Exceeding the cap raises an `SsrfGuardError` with reason
`blocked_response_size` — **never a silent truncation**, which would hand
you a partial document with no signal that it is partial. If you want
truncation, catch the error and decide that yourself.

`maxBytes` must be a non-negative integer; anything else throws a
`TypeError` before the request is made, so a bad value cannot quietly turn
the cap off. A capped response is a new `Response` object, so
`Response.url` is not carried over — use `onFinalUrl`.

### DNS pinning (optional)

By default the DNS check and the actual connection resolve the hostname
separately, leaving a small DNS-rebinding window. Install the optional
[`undici`](https://www.npmjs.com/package/undici) dependency to close it:

```bash
pnpm add undici
```

When `undici` is present, `safeFetch` *additionally* validates the resolved
addresses **inside the socket connector**, so the check and the connection
share a single DNS resolution — the same socket-level pinning the Java Apache
HttpClient adapter uses. The pre-connect DNS check still runs in every mode:
pinning narrows the rebinding window, it is never the only check
([JS-016](docs/decisions.md#js-016--a-guard-may-not-depend-on-the-host-honouring-a-hook)).
Control it explicitly with the `pinDns` option:

```ts
await safeFetch(url, policy, { pinDns: true }); // require pinning (throws without undici)
await safeFetch(url, policy, { pinDns: false }); // force check-then-fetch
```

Without `undici`, `safeFetch` falls back to check-then-fetch. That is a strong
guard rail, but use strict allowlists or a dedicated egress service for
high-risk arbitrary URL crawling.

## Runtime support: Node, Bun, Deno, Cloudflare Workers

Not every guarantee survives every runtime. Know which half of the package
you are getting:

| Surface | Node | Bun | Deno | Cloudflare Workers |
| --- | --- | --- | --- | --- |
| `validateUrl` / `UrlPolicy` / `HostPolicy` | ✅ | ✅ | ✅ | ✅ (pure URL/string checks) |
| `guardToolInput` / `guardToolInputJson` / `createGuardedToolHandler` | ✅ | ✅ | ✅ | ✅ |
| `guardedFetch` + `sameSitePolicy` (URL-time + redirect revalidation) | ✅ | ✅ | ✅ | ✅ |
| `safeFetch` (adds DNS checks) | ✅ | ✅ | ✅ | ❌ throws at runtime |
| DNS pinning via `undici` | ✅ optional | ⚠️ no effect | ✅ optional | ❌ |

Verified on Node 24, Bun 1.3.3, and Deno 2.9.5 by installing the published
package and running the public surface on each.

**⚠️ Pinning does nothing on Bun.** Bun accepts undici's
`Agent({ connect: { lookup } })` and never calls the hook. Pinning is
therefore inert there — you keep every DNS check, but not the
rebinding-window closure that pinning exists for. Nothing silently
weakens: since 0.6.1 the private-IP check runs before connecting in every
mode, on every runtime ([JS-016](docs/decisions.md#js-016--a-guard-may-not-depend-on-the-host-honouring-a-hook)).

> **Security note for Bun users on `< 0.6.1`:** in those versions pinned
> mode was the *only* DNS check, so on Bun `safeFetch` performed none at
> all and would fetch a host resolving to a private address. Because
> `pinDns` unset pins automatically whenever `undici` is installed, this
> was the default. Upgrade to 0.6.1; no code change is needed.

**Deno note.** Deno 2.x applies a minimum dependency age (24h by default)
before it will install a freshly published npm version, so `deno add`
picks the previous release for a day. That is Deno's supply-chain policy,
not a packaging problem — wait, or pass `--min-dep-age 0`.

**Why `safeFetch` cannot work in Workers.** It resolves the target with
`node:dns/promises` `lookup` before connecting. Workers' `node:dns`
(under the `nodejs_compat` flag) implements the `resolve*` functions via
DNS-over-HTTPS but `lookup` throws `Not implemented` — and even if it
resolved, Workers `fetch` performs its own resolution internally, so
userland cannot pin the checked IP to the socket the way the `undici`
connector does in Node. The check-then-fetch gap cannot be closed from
inside a Worker. (Importing the package is always safe — `node:dns` is
loaded lazily; calling `safeFetch` without it throws a typed
`SsrfGuardError` pointing here.)

**What to use in Workers instead: `guardedFetch`.** Same redirect
revalidation, credential stripping, and method-downgrade semantics as
`safeFetch`, minus the DNS checks — so the policy allowlist is the
primary control, and the fail-closed default (empty allowlist allows
nothing) is doing real work:

```ts
import { guardedFetch } from '@devslab/ssrf-guard-js';

const res = await guardedFetch('https://api.example.com/data', {
  exactHosts: ['api.example.com'],
  allowedSchemes: ['https'],
});
```

To open a specific host, put it in the allowlist — that IS the bypass
mechanism, and it stays auditable in one place. For "crawl the customer's
own site" flows, derive the allowlist from the submitted URL with
`sameSitePolicy`: the whole fetch — redirects included — is locked to
that domain (`www.` stripped so apex ↔ www redirects survive):

```ts
import { guardedFetch, sameSitePolicy } from '@devslab/ssrf-guard-js';

const input = 'https://www.customer-site.example/about';
const res = await guardedFetch(input, sameSitePolicy(input, { allowedSchemes: ['https'] }));
```

For genuinely arbitrary URL fetching from Workers, route the request
through a small Node-based egress service that calls `safeFetch` with
`pinDns: true` — the Worker talks to the egress service, never to the
user-supplied URL directly.

## Express

```ts
import express from 'express';
import { createExpressUrlGuard } from '@devslab/ssrf-guard-js';

const app = express();
app.use(express.json());

app.post(
  '/crawl',
  createExpressUrlGuard({
    exactHosts: ['example.com'],
    suffixes: ['example.com'],
    allowedSchemes: ['https'],
  }),
  async (req, res) => {
    res.json({ ok: true });
  },
);
```

The middleware scans `req.body` and `req.query` by default. It returns a
structured `400` response when it finds a blocked URL.

## Vite

Use this when your Vite dev server has SSR/proxy endpoints that receive a URL
and then fetch it server-side.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { ssrfGuardVitePlugin } from '@devslab/ssrf-guard-js/vite';

export default defineConfig({
  plugins: [
    ssrfGuardVitePlugin({
      routes: ['/api/crawl'],
      policy: {
        suffixes: ['example.com'],
        allowedSchemes: ['https'],
      },
    }),
  ],
});
```

The plugin scans query params named `url`, `target`, `uri`, and `href` by
default. Example blocked request:

```text
/api/crawl?url=http://169.254.169.254/latest/meta-data/
```

## LangChain / Agent Tools

`createGuardedToolHandler` wraps any object-input tool function without taking
a hard dependency on LangChain.

```ts
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { createGuardedToolHandler, safeFetch } from '@devslab/ssrf-guard-js';

const policy = {
  suffixes: ['example.com'],
  allowedSchemes: ['https'],
};

export const fetchUrlTool = new DynamicStructuredTool({
  name: 'fetch_url',
  description: 'Fetch an allowed URL',
  schema: z.object({ url: z.string().url() }),
  func: createGuardedToolHandler(policy, async ({ url }) => {
    const response = await safeFetch(url, policy);
    return await response.text();
  }),
});
```

If the model tries to pass a private IP, metadata URL, or non-allowed host, the
tool returns a structured `ssrf_blocked` JSON string instead of fetching it.

## Block Reasons

Thrown `SsrfGuardError` instances expose stable `reason` values:

- `blocked_scheme`
- `blocked_host`
- `blocked_port`
- `blocked_ip_literal`
- `blocked_userinfo`
- `blocked_private_ip`
- `blocked_redirect`
- `blocked_other`

## Maintainer Release

Publishing is handled by GitHub Actions. It needs an npm automation token as
the repository secret `NPM_TOKEN`.

**The merge is the release.** Open a PR that bumps `version` in
`package.json` and adds the matching `CHANGELOG.md` section, and merging it
to `main` runs `Publish to npm`, which verifies the package, publishes it
with provenance, creates the `vX.Y.Z` tag, and opens a GitHub Release whose
notes are that CHANGELOG section:

```bash
npm publish --access public --provenance
```

The gate is the npm registry, not the tag: if the version in `package.json`
is already published the workflow is a quiet no-op, so ordinary merges do
nothing and a re-run can never publish twice.

Pushing a tag by hand still works and does the same thing, minus creating
the tag:

```bash
git tag v0.5.1
git push origin v0.5.1
```

A hand-pushed tag must match `package.json` — the workflow fails if it
does not.

## Family

- [ssrf-guard](https://github.com/devslab-kr/ssrf-guard) — the JVM sibling: the same security model for Spring Boot across 9 HTTP-client modules, including `-springai` / `-langchain4j` for LLM-agent tool URL validation
- More open source from [devslab](https://github.com/devslab-kr)

## License

[Apache-2.0](./LICENSE)
