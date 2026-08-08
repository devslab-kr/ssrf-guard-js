# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] - 2026-08-08

Maintenance release. Nothing in the published package behaves
differently — both changes are to how it is built and released.

### Changed

- Build toolchain moved to TypeScript 7 (native compiler): `typescript`
  devDependency `^5.9.3` → `^7.0.2`, `tsdown` `^0.22.3` → `^0.22.14`
  (first version whose peer range admits TS 7 for `.d.ts` generation).
  No consumer-facing change — the published artifacts, type
  declarations, and supported TypeScript versions for consumers are
  unaffected.
- Release workflow uses `softprops/action-gh-release` v3 (v2 runs on the
  deprecated Node 20 runtime). CI only.

### Documentation

- Added `docs/roadmap.md` and `docs/decisions.md`, with `.ko.md` twins:
  what has shipped, what is queued, what is deliberately not planned, and
  the reasoning behind the design decisions taken through 0.5.0.

## [0.5.0] - 2026-07-30

Both additions come from the first production consumer's integration
feedback; defaults and existing signatures are unchanged.

### Added

- `scanEmbedded` option for the LLM tool-input guards (`guardToolInput`,
  `guardToolInputJson`, `createGuardedToolHandler`). Opt-in scanning for
  URLs embedded **anywhere** inside argument strings: `scheme://` URLs
  and protocol-relative `//host` references buried mid-sentence
  (`"summarize http://169.254.169.254/ please"`) are extracted and
  validated against the policy. Strictly additive — everything the base
  whole-string scanner flags stays flagged — and deliberately
  aggressive: URL-shaped text inside prose or code snippets is
  validated too, so non-allowlisted hosts there count as violations.
  Prose punctuation stuck to the URL tail (`…/docs,` / `(…)`) is
  trimmed before validation; balanced parentheses in paths survive.
  Off by default, so existing behavior is unchanged.
- `onFinalUrl` option for `guardedFetch` and `safeFetch`: called with
  the final validated URL after all redirect hops have been followed.
  More reliable than `Response.url`, which some fetch implementations
  (including custom `fetchImpl`s and test fakes) leave empty — use it
  to attribute the fetched content to its true origin. Not called when
  the fetch throws.
- `GuardToolInputOptions` and the previously unexported
  `SafeFetchOptions` are now part of the public type surface.

## [0.4.0] - 2026-07-13

### Added

- `guardedFetch` — a runtime-agnostic guarded fetch for environments that
  cannot run `safeFetch`'s DNS checks (Cloudflare Workers, browsers, edge
  runtimes). Same redirect revalidation, cross-origin credential stripping,
  and `303`/`301`/`302`-`POST` method-downgrade semantics as `safeFetch`,
  minus DNS resolution and IP pinning — the policy allowlist is the primary
  control. Accepts a `fetchImpl` override for tests and instrumented clients.
- `sameSitePolicy(url, overrides?)` — derives a `UrlPolicyOptions` allowlist
  from a submitted URL, locking the whole fetch (redirects included) to that
  domain with a leading `www.` stripped. Overrides merge additively, so
  extra hosts can be allowlisted alongside.

### Changed

- `node:dns` is now imported lazily. Importing the package no longer
  requires a functional `node:dns` module — on runtimes without one,
  `safeFetch` throws a typed `SsrfGuardError` directing callers to
  `guardedFetch` instead of failing at module load.
- `safeFetch` and `guardedFetch` share one redirect-revalidation loop
  (internal refactor; behavior unchanged, covered by the existing suite).

## [0.3.0] - 2026-07-05

### Added

- Optional DNS pinning for `safeFetch`, closing the DNS-rebinding TOCTOU
  window. When the optional `undici` peer dependency is installed, the
  resolved addresses are validated **inside the socket connector**, so the
  check and the connection share a single DNS resolution. New
  `pinDns` option: `true` requires pinning (throws without `undici`),
  `false` disables it, unset pins automatically when `undici` is available.

## [0.2.0] - 2026-07-05

Stricter-by-default release. Things that may need attention when upgrading:

- Tool inputs containing non-http `scheme://` URLs (e.g. `s3://`, custom
  protocols) are now flagged unless the scheme is in `allowedSchemes`.
- Hosts whose DNS answer mixes public and private addresses are now blocked
  by `safeFetch` (previously allowed if any address was public).
- `safeFetch` no longer replays `Authorization`/`Cookie` headers or request
  bodies across cross-origin redirects — if you depended on that, send the
  follow-up request explicitly.

### Security

- `safeFetch` / `assertResolvedIpsAllowed` now fail closed when **any**
  resolved DNS address is private/local. Previously the request was allowed as
  long as at least one address was public, so an attacker-controlled DNS
  record returning a mixed public + private answer could pass the check while
  the actual connection used the private address.
- `safeFetch` no longer forwards credentials across origins: `Authorization`,
  `Proxy-Authorization`, and `Cookie` headers are stripped when a redirect
  changes the origin.
- `safeFetch` now follows the fetch spec's redirect semantics: `303` (and
  `301`/`302` for `POST`) downgrade to `GET` and drop the request body instead
  of replaying it against the redirect target.
- The tool-input URL scanner now collects **any** `scheme://` URL (not just
  `http`/`https`), so `file://`, `ftp://`, and `gopher://` URLs in tool input
  are validated and rejected by the policy's `allowedSchemes` instead of
  passing the guard silently. Protocol-relative `//host` strings are also
  collected and validated against the host policy. Authority-less schemes
  (`mailto:`, `urn:`, `data:`) remain ignored.

### Changed

- Portless URLs now count as the scheme's default port (`http`/`ws` → `80`,
  `https`/`wss` → `443`) for the `allowedPorts` check, so
  `allowedPorts: [443]` alone works for HTTPS-only policies. `-1` still
  matches portless URLs of schemes without a known default.

### Fixed

- `safeFetch` cancels redirect response bodies before following the next hop,
  releasing the underlying connection.
- `SsrfGuardError` thrown for unparseable URLs now preserves the original
  parse error as `cause`.

## [0.1.2] - 2026-07-05

### Security

- Fixed a guard bypass where URLs with uppercase or mixed-case schemes
  (`HTTP://`, `Https://`, ...) were not collected by the tool-input scanner and
  therefore skipped policy validation entirely. This affected
  `guardToolInput`, `guardToolInputJson`, `createGuardedToolHandler`,
  `createExpressUrlGuard`, and `ssrfGuardVitePlugin`. Scheme detection is now
  case-insensitive, matching WHATWG URL scheme semantics. `validateUrl` and
  `safeFetch` were not affected — they already lowercased the scheme before
  checking it.

## [0.1.1] - 2026-06-18

### Changed

- Published under the `@devslab` npm organization scope.
- Release workflow verifies that the pushed tag matches `package.json` version.

## [0.1.0] - 2026-06-18

### Added

- Initial release: `UrlPolicy` / `validateUrl` (scheme, host allowlist, port,
  userinfo, IP-literal checks), private-network IP classification,
  `safeFetch` with DNS and redirect re-validation, LLM tool-input guards
  (`guardToolInput`, `guardToolInputJson`, `createGuardedToolHandler`),
  Express middleware, and a Vite dev-server plugin.
