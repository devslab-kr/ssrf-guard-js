# ssrf-guard-js

[한국어](README.ko.md) | [Docs](https://devslab-kr.github.io/ssrf-guard-js/)

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

### DNS pinning (optional)

By default the DNS check and the actual connection resolve the hostname
separately, leaving a small DNS-rebinding window. Install the optional
[`undici`](https://www.npmjs.com/package/undici) dependency to close it:

```bash
pnpm add undici
```

When `undici` is present, `safeFetch` automatically validates the resolved
addresses **inside the socket connector**, so the check and the connection
share a single DNS resolution — the same socket-level pinning the Java Apache
HttpClient adapter uses. Control it explicitly with the `pinDns` option:

```ts
await safeFetch(url, policy, { pinDns: true }); // require pinning (throws without undici)
await safeFetch(url, policy, { pinDns: false }); // force check-then-fetch
```

Without `undici`, `safeFetch` falls back to check-then-fetch. That is a strong
guard rail, but use strict allowlists or a dedicated egress service for
high-risk arbitrary URL crawling.

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

## License

Apache-2.0

## Maintainer Release

Publishing is handled by GitHub Actions.

1. Add an npm automation token as the repository secret `NPM_TOKEN`.
2. Bump `version` in `package.json`.
3. Commit the change.
4. Create and push a matching tag, for example:

```bash
git tag v0.2.0
git push origin main --tags
```

The `Publish to npm` workflow verifies the package, checks that the tag matches
`package.json`, then runs:

```bash
npm publish --access public --provenance
```
