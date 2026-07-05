# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
