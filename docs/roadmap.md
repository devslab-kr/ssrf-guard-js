# Roadmap

[한국어](roadmap.ko.md)

What is done, what is queued, and what is deliberately not planned.
Started 2026-08-08; everything above the "Next" section is recorded
retroactively from the CHANGELOG and merged PRs.

Sibling library: [`devslab-kr/ssrf-guard`](https://github.com/devslab-kr/ssrf-guard)
(JVM). The two share a security model, not a release train — see
[JS-010](decisions.md#js-010--version-lines-independent-of-the-jvm-sibling).

## Current state

- **Published:** `@devslab/ssrf-guard-js` **0.5.1** (npm, 2026-08-08)
- **Suite:** 153 tests across 9 files, green as of 2026-08-08
- **Entry points:** root (`.`) and `./vite`
- **Optional peer:** `undici >=6` (enables DNS pinning for `safeFetch`)
- **Production consumers:** AskLinq (`devslab-kr/asklinq`) — URL ingestion,
  brand-color probe, LLM tool-input guard, and the API bridge executor
- **Docs site:** <https://devslab-kr.github.io/ssrf-guard-js/> (English only)

## Shipped

| Version | Date | What |
| --- | --- | --- |
| 0.1.0 | 2026-06-18 | ✅ `UrlPolicy` / `validateUrl`, private-IP classification, `safeFetch`, LLM tool-input guards, Express middleware, Vite plugin |
| 0.1.1 | 2026-06-18 | ✅ Published under the `@devslab` npm scope; release workflow verifies tag ↔ `package.json` |
| 0.1.2 | 2026-07-05 | ✅ **Security:** uppercase/mixed-case scheme bypass in the tool-input scanner |
| 0.2.0 | 2026-07-05 | ✅ **Security:** mixed public/private DNS answers fail closed; cross-origin credential stripping; fetch-spec redirect semantics; scanner covers non-`http` schemes and protocol-relative `//host`; scheme-default ports |
| 0.3.0 | 2026-07-05 | ✅ Optional DNS pinning via `undici` (`pinDns`), closing the DNS-rebinding TOCTOU window |
| 0.4.0 | 2026-07-13 | ✅ `guardedFetch` + `sameSitePolicy` for Workers/browser/edge; `node:dns` imported lazily; shared redirect-revalidation loop |
| 0.5.0 | 2026-07-30 | ✅ `scanEmbedded` (opt-in mid-string URL extraction), `onFinalUrl` callback, `GuardToolInputOptions` / `SafeFetchOptions` exported |
| 0.5.1 | 2026-08-08 | ✅ Maintenance: TypeScript 7 build toolchain, `action-gh-release` v3, release-on-version-bump ([JS-013](decisions.md#js-013--the-merge-is-the-release)), this roadmap and the decision log |

Two releases came straight from consumer integration feedback: 0.4.0
(AskLinq had hand-rolled the redirect loop) and 0.5.0 (both options were
asked for by the same integration).

## Next

**Nothing is queued.** `[Unreleased]` is empty — the TypeScript 7 toolchain
and the CI bump went out as 0.5.1 on 2026-08-08, so `main` and npm agree.

The next substantive change is a candidate pick. The recommendation is to
take both P1s together: they touch the same surface (what a caller can ask
the policy, and what the guarded fetch enforces), and both exist because a
real consumer had to work around their absence.

## Candidates

Proposals, not commitments — priorities are a recommendation for the owner
to confirm. Each is backed by something observed in a real consumer or by a
parity gap with the JVM sibling.

### P1 — a non-throwing URL predicate

`validateUrl` throws and `HostPolicy.allows()` only covers the host, so a
consumer deciding "should I even enqueue this link" has no policy-shaped
API to call. AskLinq's crawler ends up hand-rolling
`target.hostname !== base.hostname` (`ingest/url.ts`, `extractSameSiteLinks`) —
which silently diverges from `sameSitePolicy`, whose `www.`-stripping means
an apex ↔ `www` link the fetch guard *would* allow gets dropped before it is
ever tried. Duplicated policy logic that drifts from the real guard is the
exact failure shape that produced the 0.1.2 bypass.

Shape: something like `isUrlAllowed(url, policy): boolean`, or a
`checkUrl(url, policy)` returning a result instead of throwing — same code
path as `validateUrl`, different return convention.

### P1 — response size cap in the guarded fetch

Both AskLinq call sites cap response size themselves, after the body is
already fully read: `BRIDGE_RESPONSE_MAX_CHARS` (`bridge/execute.ts`) and
`MAX_BODY_CHARS` (`ingest/url.ts`). A cap applied after the download is a
truncation convenience, not a protection — the bytes already crossed the
wire. A `maxBytes` option on `guardedFetch` / `safeFetch` that aborts the
stream mid-flight would make it one, and SSRF targets that stream forever
are a real class.

### P2 — `singleHostPolicy(baseUrl)`

`sameSitePolicy` strips a leading `www.` because it exists for
"crawl the customer's own site". A caller that wants the exact registered
host and nothing else re-derives the policy by hand (`policyFor` in
`bridge/execute.ts`). A sibling helper with no `www.` special-casing would
cover it, and would keep the two intents visibly distinct at call sites.

### P2 — Hono middleware

The framework adapters are Express and Vite; the one production consumer
runs Hono on Cloudflare Workers and calls `guardedFetch` directly. Hono is
also where the Workers-safe half of this package naturally lands. Ship it
as a separate entry point (`./hono`), like `./vite`, so it stays out of the
root bundle.

### P2 — bilingual docs site

`README.md` has a `README.ko.md` and the JVM sibling's mkdocs site is fully
bilingual; `site/index.html` is English only. Korean parity for the landing
page.

### P3 — recurring JVM ↔ JS parity audit

The 0.1.2 uppercase-scheme bypass existed in **both** libraries, because
both had independently written the same URL-collection filter. There is no
scheduled check that the two models still agree. A written checklist —
scanner collection rules, IP classification, redirect semantics, block
reasons — walked whenever either side changes core logic.

### P3 — a JS demo in `devslab-examples`

`devslab-kr/devslab-examples` has 8 `ssrf-guard-*` demos, all JVM. Nothing
demonstrates the JS package. A Workers-based demo would double as a
runtime check of the `guardedFetch` half.

### P3 — HTTP-client adapters (deferred on purpose)

The JVM sibling ships 6 client adapters (RestTemplate, WebClient, Feign,
OkHttp, JdkHttp, HttpClient5) because those clients own request execution.
In JS, `fetch` is the substrate and `guardedFetch`/`safeFetch` already wrap
it. Adapters for `axios`, `got`, or an `undici` interceptor should wait for
someone actually asking — the JVM module count is not a target to match.

## Not planned

- **An "allow any host" mode.** The fail-closed default is the product; an
  allowlist entry is the auditable bypass ([JS-001](decisions.md#js-001--fail-closed-host-allowlist-by-default)).
- **`safeFetch` on Cloudflare Workers.** Not a missing feature — the
  check-then-fetch gap cannot be closed from inside a Worker
  ([JS-006](decisions.md#js-006--guardedfetch-as-a-separate-export-rather-than-a-degraded-safefetch)).
- **DNS checks in the browser.** Same reason, plus no DNS API at all.
- **Matching the JVM sibling's version number.** Different maturity,
  different release cadence ([JS-010](decisions.md#js-010--version-lines-independent-of-the-jvm-sibling)).

## Maintaining this file

Update it in the same work session that merges a change — completed items
get checked with a date, and anything shipped outside this plan gets
recorded anyway. Significant product or architecture decisions go to
[decisions.md](decisions.md) as they are made, not afterwards. Both files
have a `.ko.md` twin; update the pair together.
