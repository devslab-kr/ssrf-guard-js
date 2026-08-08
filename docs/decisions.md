# Decision log

[한국어](decisions.ko.md)

Product and architecture decisions with the reasoning that produced them,
so a future reader can tell an intentional constraint from an oversight.

Entries JS-001 … JS-011 were reconstructed on 2026-08-08 from the CHANGELOG
and merged PRs — the decisions are real and the code is the evidence, but
the rationale is recorded after the fact and may be thinner than if it had
been written at the time. From JS-012 on, entries are written as decisions
are made.

Format: context → decision → alternatives → trade-off → revisit when.

---

## JS-001 — Fail-closed host allowlist by default

**Shipped:** 0.1.0 (2026-06-18)

**Context.** An SSRF guard is only as good as its default. A library that
allows everything until configured protects nobody who forgot to configure
it, and "forgot to configure it" is the population that needs the guard.

**Decision.** Empty `exactHosts` and `suffixes` allow **no host at all**.
There is no "allow any host" switch. Opening a host means putting it in the
allowlist, which keeps every exception auditable in one place. Private
networks, IP-literal hosts, and userinfo are rejected by default too.

**Alternatives.** A permissive default with an opt-in strict mode (the
common shape); a denylist of known-bad targets (metadata IPs, RFC1918).

**Trade-off.** Higher friction on first use, and callers who genuinely need
arbitrary URLs must derive a policy per request — which is what
`sameSitePolicy` ([JS-007](#js-007--samesitepolicy-strips-a-leading-www)) is for.
A denylist would be friendlier and would have been wrong: the interesting
targets are the ones nobody enumerated.

**Revisit when.** Never for the default. If arbitrary-URL fetching becomes
a real use case, it gets an explicitly named, separately documented API —
not a flag on the existing one.

---

## JS-002 — The tool-input scanner collects every scheme, not just http(s)

**Shipped:** 0.2.0 (2026-07-05)

**Context.** The scanner originally collected only `http://` and `https://`
strings, so `file://`, `ftp://`, and `gopher://` URLs in LLM tool input
passed the guard silently — never validated, so `allowedSchemes` never got
to reject them.

**Decision.** Collect **any** `scheme://` URL and let the policy decide.
Protocol-relative `//host` strings are collected and validated against the
host policy. Authority-less schemes (`mailto:`, `urn:`, `data:`) stay
ignored — they have no host to check.

**Alternatives.** A wider hardcoded scheme list; leaving non-http schemes
to the caller.

**Trade-off.** Strictly stricter — inputs that used to pass now raise
violations, which is why it shipped in a minor bump with a note. Collection
and policy are now cleanly separated: collection is generous, the policy
decides.

**Revisit when.** A legitimate authority-less scheme needs host-like
validation.

---

## JS-003 — Mixed public/private DNS answers fail closed

**Shipped:** 0.2.0 (2026-07-05)

**Context.** `safeFetch` allowed a host if **any** resolved address was
public. An attacker controlling a DNS record could return a public and a
private address together: the check passed on the public one, the
connection could use the private one.

**Decision.** If **any** resolved address is private or local, the request
is blocked.

**Alternatives.** Keep the any-public rule and rely on DNS pinning
([JS-005](#js-005--dns-pinning-via-an-optional-undici-peer-dependency)) to close it — pinning
was not yet shipped, and it is optional even now.

**Trade-off.** Hosts with legitimately mixed split-horizon DNS become
unreachable. Acceptable: this is a security library, and that topology is
rare next to the attack it enables.

**Revisit when.** Never, absent evidence that the false-positive rate
actually hurts real deployments.

---

## JS-004 — Fetch-spec redirect semantics, and no credentials across origins

**Shipped:** 0.2.0 (2026-07-05)

**Context.** `safeFetch` replayed headers and bodies across redirects. A
redirect to an attacker-controlled origin therefore carried the caller's
`Authorization` and `Cookie` headers, and re-sent the original `POST` body.

**Decision.** Strip `Authorization`, `Proxy-Authorization`, and `Cookie`
when a redirect changes origin, and follow the fetch spec: `303` (and
`301`/`302` for `POST`) downgrade to `GET` and drop the body.

**Alternatives.** An option to preserve credentials for trusted redirect
chains.

**Trade-off.** Callers who relied on replay must issue the follow-up
request themselves. Matching the platform's own semantics beats a bespoke
rule nobody can predict.

**Revisit when.** Never — this is the spec.

---

## JS-005 — DNS pinning via an optional `undici` peer dependency

**Shipped:** 0.3.0 (2026-07-05)

**Context.** Check-then-fetch leaves a TOCTOU window: the guard resolves
the host, then `fetch` resolves it again, and DNS rebinding can make the
two answers differ. Closing it requires validating inside the socket
connector — which needs a real HTTP agent.

**Decision.** Take `undici` as an **optional** peer dependency. Present →
validate in the connector so check and connection share one resolution
(the same socket-level pinning the JVM Apache HttpClient adapter uses).
Absent → fall back to check-then-fetch. `pinDns: true` demands pinning and
throws without `undici`; `false` forces the fallback; unset auto-detects.

**Alternatives.** A hard `undici` dependency (weight and version coupling
on every consumer, including those who only want `validateUrl`); shipping
our own agent; leaving the window open.

**Trade-off.** The strongest guarantee is off unless the consumer installs
something, and the docs must keep saying so. In exchange the package stays
dependency-free for the URL-policy and tool-guard users, who are the
majority.

**Revisit when.** `undici` becomes ubiquitous enough to make it a plain
dependency, or the platform exposes connector-level hooks natively.

---

## JS-006 — `guardedFetch` as a separate export rather than a degraded `safeFetch`

**Shipped:** 0.4.0 (2026-07-13)

**Context.** `safeFetch` resolves the target with `node:dns/promises`
`lookup` before connecting. On Cloudflare Workers `lookup` throws
`Not implemented`, and even if it resolved, Workers `fetch` does its own
resolution internally — userland cannot pin the checked IP to the socket.
The check-then-fetch gap is unclosable from inside a Worker.

**Decision.** Ship a second function. `guardedFetch` keeps URL-time
validation, per-hop redirect revalidation, credential stripping, and
method-downgrade semantics, and **drops** the DNS checks. `safeFetch` on a
runtime without `node:dns` throws a typed `SsrfGuardError` pointing at
`guardedFetch` instead of failing at import. `node:dns` is imported
lazily so importing the package is always safe.

**Alternatives.** Silently skipping the DNS checks when unavailable — the
same call would then mean two different guarantees depending on where it
ran, which is how a security control quietly becomes decorative.

**Trade-off.** Two functions to explain, and a README table pinning down
which guarantees survive which runtime. Worth it: the weaker guarantee is
named at the call site.

**Revisit when.** Workers gains a usable `lookup` **and** a way to pin the
resolved address to the connection. Both, or nothing changes.

---

## JS-007 — `sameSitePolicy` strips a leading `www.`

**Shipped:** 0.4.0 (2026-07-13)

**Context.** "Crawl the customer's own site" needs a per-request policy
derived from the submitted URL. Real sites redirect apex ↔ `www` constantly,
and a policy locked to the exact submitted host fails on the first hop.

**Decision.** Derive the allowlist from the submitted URL with a leading
`www.` stripped, so apex and `www` are one site. Overrides merge
additively, so extra hosts can be allowlisted alongside.

**Alternatives.** Exact host only (breaks on the redirect); registrable-domain
matching via a public-suffix list (a dependency and a data file to keep
fresh, for a case `www` covers).

**Trade-off.** `www.` is special-cased by name, which is a heuristic and
not a rule. Callers who want the exact host and nothing else currently
re-derive the policy by hand — a `singleHostPolicy` helper is on the
[roadmap](roadmap.md#p2--singlehostpolicybaseurl).

**Revisit when.** Other conventional prefixes prove to matter, or a
consumer needs true registrable-domain scope.

---

## JS-008 — `scanEmbedded` is opt-in

**Shipped:** 0.5.0 (2026-07-30)

**Context.** The base scanner flags strings whose whole trimmed value is a
URL. A model asked to `"summarize http://169.254.169.254/ please"` slips a
metadata URL through in prose.

**Decision.** Extract URLs from **anywhere** inside argument strings, but
behind an opt-in flag. Strictly additive: everything the base scanner
flagged stays flagged. Deliberately aggressive within its own scope — URLs
inside prose or code snippets get validated too, so a non-allowlisted host
in an example counts as a violation. Trailing prose punctuation is trimmed;
balanced parentheses in paths survive.

**Alternatives.** On by default (a silently stricter minor release for
every consumer, with code snippets and documentation-quoting tools as the
obvious false-positive population); a heuristic that guesses whether the
surrounding text is prose or code — unpredictable in exactly the situation
where predictability matters.

**Trade-off.** The safer behavior is off unless you ask for it, so anyone
who doesn't read the docs keeps the weaker scan. Accepted because the
option is aggressive by design: turning it on is a decision about your own
tool inputs, and it should be a decision.

**Revisit when.** Field evidence shows the false-positive rate is low
enough to flip the default in a major release.

---

## JS-009 — `onFinalUrl` instead of relying on `Response.url`

**Shipped:** 0.5.0 (2026-07-30)

**Context.** After following redirects, a caller needs the URL the content
actually came from — for provenance labels, for storage keys. `Response.url`
is the obvious source and is unreliable: custom `fetchImpl`s and test fakes
are allowed to leave it empty, and after a redirect an empty value silently
mislabels the content with the *submitted* URL.

**Decision.** A callback invoked with the final **guard-validated** URL once
all hops are followed, on both `guardedFetch` and `safeFetch`. Not called
when the fetch throws.

**Alternatives.** Returning a wrapper object (breaking — the return type is
a plain `Response`); documenting `Response.url` and leaving the fallback to
consumers, which is what the consumer was already doing wrong.

**Trade-off.** A callback for a value is an awkward shape, forced by
keeping the return type a `Response`. It also reports the guard's view
rather than the fetch implementation's — the point, but worth knowing.

**Revisit when.** An options-in/result-out variant of the fetch API is
introduced for other reasons; this would fold into it.

---

## JS-010 — Version lines independent of the JVM sibling

**Shipped:** implicit since 0.1.0

**Context.** `kr.devslab:ssrf-guard` is on `3.x.y` under the org rule that
the library major tracks the Spring Boot major. This package has no Spring
Boot, and started later with a smaller surface.

**Decision.** Version `@devslab/ssrf-guard-js` on its own `0.x` line by its
own maturity. The two libraries share a security model and cross-link in
their READMEs; they do not share a release train, and a version number is
not a promise of feature parity.

**Alternatives.** Mirroring the JVM version (meaningless here — the number
encodes a Spring Boot major); forcing lockstep releases (couples two
codebases with different consumers and different cadences).

**Trade-off.** A reader can't infer "same version = same features". The
CHANGELOGs and the README's Family section carry that instead.

**Revisit when.** 1.0 — worth stating explicitly then what parity does and
does not mean.

---

## JS-011 — TypeScript 7 for the build toolchain only

**Shipped:** merged, unreleased (PR #15, 2026-07-30)

**Context.** TypeScript 7's native compiler is substantially faster.
Adopting it in a published library risks changing emitted declarations,
which would be a consumer-facing break in a package whose types are part
of its surface.

**Decision.** Move the **build** toolchain: `typescript` `^5.9.3` → `^7.0.2`
and `tsdown` to the first version whose peer range admits TS 7 for `.d.ts`
generation. Published artifacts, type declarations, and the TypeScript
versions supported for consumers are unchanged.

**Alternatives.** Waiting for the ecosystem; also raising the consumer-facing
TypeScript floor (a breaking change with no benefit to consumers).

**Trade-off.** An early dependency on a new major in the toolchain, and the
"no consumer-facing change" claim rests on the artifacts staying identical —
so it needs verifying at each bump, not assuming.

**Revisit when.** Raising the consumer-facing TypeScript floor is proposed
on its own merits.

---

## JS-012 — Roadmap and decision log adopted in-repo

**Date:** 2026-08-08

**Context.** Through 0.5.0 this repo had no `docs/`. Direction lived in
CHANGELOG prose and PR bodies, so questions like "what's next" or "why is
`scanEmbedded` off by default" had no answer short of reading the history.
Sibling repos in the org carry `docs/roadmap.md` + `docs/decisions.md`.

**Decision.** Adopt both, bilingually (`.md` + `.ko.md`), matching the
README pair. The roadmap is updated in the same work session that merges a
change; decisions are recorded as they are made.

**Alternatives.** GitHub issues as the backlog (fine for tasks, poor for
rationale, and no issues had been filed here); leaving it in the CHANGELOG
(records what shipped, never what was rejected or why).

**Trade-off.** Four files to keep current, and stale planning docs are
worse than none — hence the same-session rule.

**Revisit when.** The docs site grows a published planning page and these
become its source.
