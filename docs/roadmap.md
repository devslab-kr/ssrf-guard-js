# Roadmap

[한국어](roadmap.ko.md)

What is done, what is queued, and what is deliberately not planned.
Started 2026-08-08; everything above the "Next" section is recorded
retroactively from the CHANGELOG and merged PRs.

Sibling library: [`devslab-kr/ssrf-guard`](https://github.com/devslab-kr/ssrf-guard)
(JVM). The two share a security model, not a release train — see
[JS-010](decisions.md#js-010--version-lines-independent-of-the-jvm-sibling).

## Current state

- **Published:** `@devslab/ssrf-guard-js` **0.7.2** (npm, 2026-08-17)
- **Suite:** 223 tests across 15 files, green as of 2026-08-17
- **Runtimes:** Node 22+, Bun, Deno verified by installing the published
  package and running the surface on each; Workers for the non-DNS half
- **Entry points:** root (`.`), `./vite`, and `./hono`
- **Optional peer:** `undici ^6.28.0 || >=7.29.0` (enables DNS pinning for `safeFetch`)
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
| 0.7.1 | 2026-08-09 | ✅ **Security:** `::` and `fec0::/10` were classified as public — found by the first [JVM ↔ JS parity audit](parity.md), which also opened [ssrf-guard#20](https://github.com/devslab-kr/ssrf-guard/pull/20) on the Java side |
| 0.7.2 | 2026-08-17 | ✅ **Security maintenance:** excluded vulnerable undici 7.0.0–7.28.x peer resolutions; verification now uses undici 8.10.0 and Hono 4.13.2 |
| — | 2026-08-09 | ✅ Docs site: English at `/`, Korean at `/ko/` ([JS-017](decisions.md#js-017--the-landing-page-follows-the-repos-paired-file-convention)) — no release, the site deploys from `main` |
| — | 2026-08-09 | ✅ First JVM ↔ JS parity audit ([parity.md](parity.md)) — four findings fixed across both libraries, one left open |
| — | 2026-08-09 | ✅ `ssrf-guard-js-workers-demo` in [devslab-examples](https://github.com/devslab-kr/devslab-examples) — that repo's first Node demo |

Two releases came straight from consumer integration feedback: 0.4.0
(AskLinq had hand-rolled the redirect loop) and 0.5.0 (both options were
asked for by the same integration).

## Next

**The roadmap is empty for the first time.** Every P1, P2 and P3 item is
either shipped or a deliberate non-goal:

| Item | Outcome |
| --- | --- |
| P1 — non-throwing predicate, `maxBytes` | 0.6.0 |
| P2 — `singleHostPolicy`, Hono middleware | 0.7.0 |
| P2 — bilingual docs site | 2026-08-09, English at `/` and Korean at `/ko/` |
| P2 — a CI job per supported runtime | Node + Bun + Deno matrix, covering every entry point |
| P3 — JVM ↔ JS parity audit | round 1 run; four findings fixed across both libraries, one left open with its reasoning |
| P3 — a JS demo in `devslab-examples` | `ssrf-guard-js-workers-demo`, the first Node demo in that repo |
| P3 — HTTP-client adapters | not planned, on purpose |

**The one named piece of work left** is in [parity.md](parity.md): OkHttp
re-checks only what its `Dns` layer sees on a redirect hop — the host
allowlist and private IPs — so scheme, port, userinfo and IP-literal rules
are not re-applied. The residual risk is narrower than it sounds, since
the host allowlist and private-IP filter still hold per hop; what gets
through is the *same allowlisted host* on another port or scheme, or with
userinfo. Closing it needs the treatment `jdkhttp` got in JVM 3.3.0 —
disable the client's own following and drive the loop — which changes that
adapter's contract, so it belongs in its own release rather than stacked
on one that already carries a breaking change.

Standing follow-up outside this repo: AskLinq adopted `singleHostPolicy`
in its D-034 but not `createHonoUrlGuard`, and deliberately — every URL it
accepts is one it must then lock *to*, so there is no static allowlist for
a middleware to enforce. That is a finding, not a gap.

## Candidates

Nothing here is queued. What is left is the one thing deliberately not
planned, kept written down so the question does not get re-asked from
scratch.

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
