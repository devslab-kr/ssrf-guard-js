# ssrf-guard-js

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
- `allowedPorts`: `[-1, 80, 443]`
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
array, or explanation field is still blocked.

## Guarded Fetch

```ts
import { safeFetch } from '@devslab/ssrf-guard-js';

const response = await safeFetch('https://api.example.com/data', {
  exactHosts: ['api.example.com'],
  allowedSchemes: ['https'],
});
```

`safeFetch` validates the URL, checks DNS results for private/local IPs, and
revalidates every redirect hop.

Node's built-in `fetch` does not expose the same socket-level IP pinning API
that the Java Apache HttpClient adapter uses. Treat `safeFetch` as a strong
guard rail, but use strict allowlists or a dedicated egress service for
high-risk arbitrary URL crawling.

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
git tag v0.1.0
git push origin main --tags
```

The `Publish to npm` workflow verifies the package, checks that the tag matches
`package.json`, then runs:

```bash
npm publish --access public --provenance
```
