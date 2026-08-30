# ssrf-guard-js-workers-demo

[한국어](README.ko.md)

Part of [Open source by DevsLab](https://devslab.kr/brand/open-source/).

SSRF defence on **Cloudflare Workers**, using
[`@devslab/ssrf-guard-js`](https://github.com/devslab-kr/ssrf-guard-js) —
the JS/TS sibling of `kr.devslab:ssrf-guard`.

Every other ssrf-guard demo in this repo guards a Spring HTTP client. This
one is the edge story, and it is a different story: on Workers there is no
usable `dns.lookup`, and even if there were, `fetch` resolves the host
itself — so a userland DNS check cannot be pinned to the socket that
actually connects.

The library's answer is to **not pretend**. `safeFetch` refuses to run
here, with a typed error pointing at `guardedFetch`, rather than degrading
into a weaker check that looks like the same call. What still holds is
URL-time validation, per-hop redirect revalidation, credential stripping,
response-size caps, and the tool-input scanner — with the allowlist doing
the load-bearing work.

## Run it

```bash
pnpm install
pnpm verify        # typecheck + tests, no network and no Cloudflare account
pnpm dev           # wrangler dev, if you want to curl it
```

## Endpoints

| Endpoint | Shows |
| --- | --- |
| `POST /crawl` | `guardedFetch` + `sameSitePolicy` — fetch a page of the site the *user* submitted |
| `POST /api-call` | `createHonoUrlGuard` middleware + `singleHostPolicy` — one registered endpoint and nowhere else |
| `POST /tool-input` | `guardToolInputJson` with `scanEmbedded` — URLs hidden anywhere in LLM tool arguments |
| `GET /attack-matrix` | `checkUrl` over 17 known SSRF payloads, reported rather than thrown |
| `GET /why-no-safe-fetch` | the refusal above, live |

## The two policies, and why both exist

The demo deliberately shows both, because picking the wrong one is the
mistake this API surface is shaped to prevent.

**`/api-call` uses the middleware.** The endpoint is known ahead of time,
so a fixed allowlist can be enforced *before* the handler runs — a URL
smuggled into any field of the request body never reaches your code.

**`/crawl` cannot use the middleware**, and that is not an oversight. Its
policy is *derived from what the user submitted*: `sameSitePolicy(url)`
locks the whole fetch, redirects included, to that domain. A fixed
allowlist would reject every submission; a permissive one would claim a
safety property it does not have. The guard belongs at the fetch.

## `singleHostPolicy` locks the port too

The registered API in this demo is `https://api.example.com:8443/v1`, and
the attack matrix has a row worth reading:

```
https://api.example.com/v1/ok      blocked_port
https://api.example.com:8443/v1/ok allowed
```

Same host, same scheme, blocked on the port alone. Written by hand as
`{ exactHosts: [u.hostname] }`, that policy would **reject its own base
URL**, because the package default `allowedPorts` is `[-1, 80, 443]` —
quietly, and only on non-standard-port deployments.

## What the tests do and do not prove

`pnpm test` drives the Worker through Hono's own request helper with
`fetch` injected, so the guard's behaviour is asserted without network
access: which payloads are refused, which reason fires, and that a blocked
redirect never issues its second hop.

They run on **Node**, not on the Workers runtime. So
`GET /why-no-safe-fetch` is asserted only for its response *shape* — on
Node, `node:dns` exists and `safeFetch` gets as far as a real lookup, which
fails for a different reason than it would on a Worker. Asserting the
Workers-specific message there would be a test that passes for the wrong
reason.

## Versions

- `@devslab/ssrf-guard-js` 0.7.1 — `checkUrl`/`isUrlAllowed` (0.6.0),
  `maxBytes` (0.6.0), `singleHostPolicy` and the Hono middleware (0.7.0)
- `hono` 4.x
