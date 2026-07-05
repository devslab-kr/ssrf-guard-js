# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Fixed

- `safeFetch` cancels redirect response bodies before following the next hop,
  releasing the underlying connection.

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
