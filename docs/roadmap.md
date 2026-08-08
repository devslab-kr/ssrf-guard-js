# Roadmap

[한국어](roadmap.ko.md)

What is done, what is queued, and what is deliberately not planned.
Started 2026-08-08; everything above the "Next" section is recorded
retroactively from the CHANGELOG and merged PRs.

Sibling library: [`devslab-kr/ssrf-guard`](https://github.com/devslab-kr/ssrf-guard)
(JVM). The two share a security model, not a release train — see
[JS-010](decisions.md#js-010--version-lines-independent-of-the-jvm-sibling).

## Current state

- **Published:** `@devslab/ssrf-guard-js` **0.7.0** (npm, 2026-08-08)
- **Suite:** 219 tests across 15 files, green as of 2026-08-08
- **Runtimes:** Node 22+, Bun, Deno verified by installing the published
  package and running the surface on each; Workers for the non-DNS half
- **Entry points:** root (`.`), `./vite`, and `./hono`
- **Optional peer:** `undici >=6` (enables DNS pinning for `safeFetch`)
- **Production consumers:** AskLinq (`devslab-kr/asklinq`) — URL ingestion,
  brand-color probe, LLM tool-input guard, and the API bridge executor
- **Docs site:** <https://devslab-kr.github.io/ssrf-guard-js/> — English, with
  Korean at `/ko/`

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
| 0.6.1 | 2026-08-08 | ✅ **Security:** `safeFetch` ran no DNS checks on Bun when pinning was active (the default with `undici` installed) — the pre-connect check now runs in every mode ([JS-016](decisions.md#js-016--a-guard-may-not-depend-on-the-host-honouring-a-hook)) |
| 0.7.0 | 2026-08-08 | ✅ `singleHostPolicy` (origin lock, port included) and `createHonoUrlGuard` at `./hono` ([JS-018](decisions.md#js-018--singlehostpolicy-locks-the-origin-port-included), [JS-019](decisions.md#js-019--the-hono-adapter-is-typed-structurally-and-tested-against-real-hono)) |
| — | 2026-08-09 | ✅ Docs site: English at `/`, Korean at `/ko/` ([JS-017](decisions.md#js-017--the-landing-page-follows-the-repos-paired-file-convention)) — no release, the site deploys from `main` |

Two releases came straight from consumer integration feedback: 0.4.0
(AskLinq had hand-rolled the redirect loop) and 0.5.0 (both options were
asked for by the same integration).

## Next

**Nothing is queued.** The two code P2s shipped in 0.7.0 on 2026-08-08
([JS-018](decisions.md#js-018--singlehostpolicy-locks-the-origin-port-included),
[JS-019](decisions.md#js-019--the-hono-adapter-is-typed-structurally-and-tested-against-real-hono)),
so `[Unreleased]` is empty and `main` agrees with npm.

What remains under P2 is the docs-site language gap; P3 is unchanged.
There is also standing follow-up work these releases create rather than
close: AskLinq consumed `isUrlAllowed` and `maxBytes` in its D-032, but
still hand-derives a single-host policy in `bridge/execute.ts` and calls
`guardedFetch` directly from Hono routes. Until it adopts
`singleHostPolicy` and `createHonoUrlGuard`, the library has the API and
the consumer still carries the workaround.

## Candidates

Proposals, not commitments — priorities are a recommendation for the owner
to confirm. Each is backed by something observed in a real consumer or by a
parity gap with the JVM sibling.

### P2 — a CI job per supported runtime

*Mostly closed by 0.6.1.* Bun and Deno are now installed, exercised, and
listed in the README support table, and asking the question found a
security bug rather than confirming a guess — pinned mode had removed
every DNS check on Bun ([JS-016](decisions.md#js-016--a-guard-may-not-depend-on-the-host-honouring-a-hook)).

What remains is the part that keeps it true: CI is still a single Node 22
job, so the Bun and Deno results are a measurement taken once, not a
guarantee maintained. Add a job per runtime. Note that the regression test
for JS-016 runs the hostile-runtime case *inside* the Node suite by
mocking `undici`, so the runtime matrix is defence in depth here rather
than the only net.

Two things already documented in the README that this item should keep in
view:

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
