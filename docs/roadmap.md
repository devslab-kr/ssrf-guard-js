# Roadmap

[한국어](roadmap.ko.md)

What is done, what is queued, and what is deliberately not planned.
Started 2026-08-08; everything above the "Next" section is recorded
retroactively from the CHANGELOG and merged PRs.

Sibling library: [`devslab-kr/ssrf-guard`](https://github.com/devslab-kr/ssrf-guard)
(JVM). The two share a security model, not a release train — see
[JS-010](decisions.md#js-010--version-lines-independent-of-the-jvm-sibling).

## Current state

- **Published:** `@devslab/ssrf-guard-js` **0.6.0** (npm, 2026-08-08)
- **Suite:** 187 tests across 11 files, green as of 2026-08-08
- **Entry points:** root (`.`) and `./vite`
- **Optional peer:** `undici >=6` (enables DNS pinning for `safeFetch`)
- **Production consumers:** AskLinq (`devslab-kr/asklinq`) — URL ingestion,
  brand-color probe, LLM tool-input guard, and the API bridge executor
- **Docs site:** <https://devslab-kr.github.io/ssrf-guard-js/> (Korean only)

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
| 0.6.0 | 2026-08-08 | ✅ `checkUrl` / `isUrlAllowed` (non-throwing policy check), `maxBytes` response cap with the new `blocked_response_size` reason |

Two releases came straight from consumer integration feedback: 0.4.0
(AskLinq had hand-rolled the redirect loop) and 0.5.0 (both options were
asked for by the same integration).

## Next

**Nothing is queued.** Both P1s shipped in 0.6.0 on 2026-08-08
([JS-014](decisions.md#js-014--the-non-throwing-check-catches-validate-rather-than-re-deriving-it),
[JS-015](decisions.md#js-015--maxbytes-blocks-rather-than-truncates)), so
`[Unreleased]` is empty and `main` agrees with npm.

The next substantive change is a P2 pick. There is also follow-up work
these releases created rather than closed: AskLinq should now drop its
hand-rolled `hostname !==` link filter and its after-the-fact size caps in
favour of `isUrlAllowed` and `maxBytes`. Until it does, the library gained
the API but the consumer still carries the workaround.

## Candidates

Proposals, not commitments — priorities are a recommendation for the owner
to confirm. Each is backed by something observed in a real consumer or by a
parity gap with the JVM sibling.

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
bilingual; `site/index.html` is Korean only. English parity for the landing
page — the gap is the wrong way round from the rest of the repo, where
English is the primary and `.ko.md` the translation. The landing page is
the first thing an npm visitor sees, and it is the one surface a
non-Korean reader cannot fall back from.

### P2 — say which runtimes are supported, and test them

The support table in `README.md` has two columns, Node and Cloudflare
Workers. Bun and Deno are not excluded by design — they are simply absent
from it, and CI is a single Node 22 job, so nothing tells us whether they
work.

Measured on 2026-08-08, against the built `dist/` on Bun 1.3.3: the whole
public surface passes, **including** the two most Node-coupled paths —
`safeFetch`'s `node:dns/promises` lookup and `pinDns: true`'s `undici`
`Agent` wiring. Bun already works. What is missing is a CI job proving it
stays that way and a column in the table saying so. Deno is untested (not
installed locally); it implements both `node:dns` and `node:url`, so the
expectation is the same, but the point of this item is to stop
expecting and start measuring.

Two things to document while doing it, both currently unstated:

- **`node:url` is a static import**, not a lazy one. `normalizeHost` in
  `src/net.ts` calls `domainToASCII`, so the "runs anywhere" half of the
  package (`validateUrl`, `guardedFetch`, the tool-input guards) pulls a
  Node builtin in at module load. Workers therefore needs `nodejs_compat`
  for `validateUrl`, not just for `safeFetch` as the README implies, and
  a browser bundle needs the bundler to supply it.
- **Do not "fix" that by swapping in the WHATWG URL parser.** It looks
  like a drop-in — `new URL('https://' + host).hostname` matched
  `domainToASCII` on all 17 normal cases tried, punycode, confusables
  (`ⓔxample.com` → `example.com`), trailing dots, and IP literals
  included. It then diverged on 4 of 15 adversarial ones, every time in
  the unsafe direction, where `domainToASCII` returns `''` and the URL
  parser returns a host: `api.example.com:443@evil.com` → `evil.com`,
  `user@evil.com` → `evil.com`, `127.0.0.1:80` → `127.0.0.1`. A
  normalizer that resolves a userinfo trick to a bare host is the 0.1.2
  bypass shape again — two implementations of one filter, drifting (see
  the parity-audit item below). If the eager import ever has to go, it
  needs a real differential test, not a find-replace.

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
