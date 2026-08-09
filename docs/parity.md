# JVM ↔ JS parity

[한국어](parity.ko.md)

`@devslab/ssrf-guard-js` and [`kr.devslab:ssrf-guard`](https://github.com/devslab-kr/ssrf-guard)
ship the same security model in two languages. They do **not** share code,
a release train, or version numbers ([JS-010](decisions.md#js-010--version-lines-independent-of-the-jvm-sibling)) —
only the model. Nothing enforces that the two implementations still agree,
which is what this document is for.

**Why it exists.** The 0.1.2 / 3.1.1 uppercase-scheme bypass was present in
**both** libraries, because both had independently written the same
URL-collection filter and both got it wrong the same way. A divergence
between the two is not a cosmetic inconsistency: whichever side is looser
is a hole, and nobody is looking at the seam.

## When to walk this

Whenever **either** side changes core logic — the scanner, IP
classification, redirect handling, or the block-reason vocabulary. Not on
adapter or docs changes.

## The checklist

| # | Area | What to compare |
| --- | --- | --- |
| 1 | **Scanner collection** | Which strings become candidates: scheme forms, case sensitivity, protocol-relative `//host`, authority-less schemes, embedded (`scanEmbedded`) patterns, tail trimming |
| 2 | **IP classification** | Every private/local range, both families: IPv4 table, IPv6 table, IPv4-mapped and 6to4 unwrapping, unspecified and site-local |
| 3 | **Redirect semantics** | What is re-validated per hop, method downgrade, body dropping, credential stripping |
| 4 | **Block reasons** | The stable string vocabulary both sides emit |

**Compare behaviour, not source.** Reading two implementations side by side
is how the 0.1.2 bug survived review in the first place. Run the inputs
through both and compare outputs.

## Audit — 2026-08-09

First run. Findings in both directions.

### Resolved

| # | Finding | Looser side | Fix |
| --- | --- | --- | --- |
| 1 | Tool-input scanner collected only `http(s)://`, and discarded other schemes before the policy saw them — `file://`, `gopher://`, `ftp://` passed in silence | **JVM** | [ssrf-guard#20](https://github.com/devslab-kr/ssrf-guard/pull/20), released in 3.3.0 |
| 2 | Protocol-relative `//host` not collected at all, though it inherits the caller's scheme at fetch time | **JVM** | same PR |
| 3 | `::` (IPv6 unspecified) classified as public — the JVM side catches it via `isAnyLocalAddress()` | **JS** | 0.7.1 |
| 4 | `fec0::/10` (IPv6 site-local, deprecated by RFC 3879 but still routed on older networks) classified as public — the JVM side catches it via `isSiteLocalAddress()` | **JS** | 0.7.1 |
| 5 | Redirect hops were re-validated differently by every adapter: `httpclient5` scheme + DNS, `okhttp` host + private IP, `jdkhttp` **nothing at all** — so port, userinfo and IP-literal rules were not re-applied on a hop | **JVM** | [ssrf-guard#21](https://github.com/devslab-kr/ssrf-guard/pull/21), released in 3.3.0 — for `jdkhttp` and `httpclient5` |

Findings 1 and 2 are the same shape as the bug that motivated this
document: a filter at the *collection* stage, letting a URL skip
validation entirely rather than being rejected by it.

Finding 5 produced a new core type, `RedirectGuard`, holding the one
definition of what a hop must pass. The loop cannot move to core the way
it lives in one place on the JS side — on the JVM each client owns its own
redirect loop — but the *decision* can, and each adapter improvising it
was the divergence.

### Open

| Finding | Looser side | Why it is still open |
| --- | --- | --- |
| **OkHttp** redirect hops still re-check only what the `Dns` layer sees — the host allowlist and private IPs. Scheme, port, userinfo and IP-literal rules are not re-applied | **JVM** | A network interceptor looks like the seam and is not one: OkHttp invokes it **after** the connection is established, so the request has already reached the internal host. Measured, not assumed — the attempt failed with `SocketException: Network is unreachable` against a metadata address, which is the socket having been opened. Closing it needs the `jdkhttp` treatment: disable OkHttp's own following and drive the loop, which changes that adapter's contract |

### Verified equivalent

- **IPv4 private ranges** — identical sets: `0.0.0.0/8`, `10/8`,
  `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`,
  `198.18/15`, broadcast. Multicast is covered on both sides, in the v4
  table on JS and at the `InetAddress` level on the JVM.
- **IPv4-mapped (`::ffff:`) and 6to4 (`2002::/16`) unwrapping** — both
  re-classify the embedded v4 address, so `::ffff:10.0.0.5` and
  `2002:0a00::1` are blocked on both.
- **Uppercase schemes** — fixed on both (0.1.2 / 3.1.1); re-confirmed.
- **Block-reason vocabulary** — identical, except `blocked_response_size`,
  which is JS-only because `maxBytes` is a JS-only feature
  ([JS-015](decisions.md#js-015--maxbytes-blocks-rather-than-truncates)).
  A JVM equivalent would need this reason too.

### Method

Findings 3 and 4 were measured, not inferred: the address list was run
through the built package and the results compared against what the JVM
helpers return, rather than reasoning from the two sources. Reasoning is
what produced the original bug.

```
false ::          ← JVM: isAnyLocalAddress() → true
false fec0::1     ← JVM: isSiteLocalAddress() → true
```

Finding 5's *attempted* fix was disproved the same way. An OkHttp network
interceptor looked like the right seam; the test against a metadata
address failed with `SocketException: Network is unreachable`, which is
the socket having been opened before the check ran. A code review would
have called that interceptor correct.

## Known-divergent by design

Not everything should match. These are deliberate:

- **`maxBytes` / `blocked_response_size`** — JS only, so far.
- **`checkUrl` / `isUrlAllowed`** — JS only; the JVM side has no
  non-throwing predicate.
- **`singleHostPolicy` / `sameSitePolicy`** — JS only.
- **Adapters** — the JVM ships six HTTP-client modules because those
  clients own request execution; JS wraps `fetch` and needs one
  ([roadmap](roadmap.md)).
- **Version numbers** — [JS-010](decisions.md#js-010--version-lines-independent-of-the-jvm-sibling).

A JS-only feature is not a parity failure. A JS-only feature that the JVM
side *also* has, implemented differently, is.
