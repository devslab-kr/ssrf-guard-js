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

**Shipped:** 0.5.1 (2026-08-08; merged as PR #15, 2026-07-30)

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

---

## JS-013 — The merge is the release

**Date:** 2026-08-08 (shipped with 0.5.1)

**Context.** `Publish to npm` fired only on a `vX.Y.Z` tag push, so a
release needed a local `git tag` + `git push` after the merge. Everything
else in the org deploys from a merge to `main` — the docs site in this very
repo already does. The tag step was also the one part of the flow an agent
could not perform, so 0.5.1 sat merged and unpublished waiting on a human
to run one command.

**Decision.** Publish on a push to `main` whose `package.json` `version` is
not on npm yet. The workflow verifies, publishes, creates the tag itself,
and opens the GitHub Release from the CHANGELOG section. A hand-pushed tag
still works unchanged and must still match `package.json`.

**The gate is the npm registry, not the tag.** That choice does the work:
ordinary merges are a quiet no-op, and the job is idempotent — a re-run
after a partial failure cannot double-publish. Gating on tag existence
would have inverted the failure mode: a publish that failed *after* tagging
would make every later run skip silently, which is the worst possible way
for a release to break. Tagging therefore happens after the publish
succeeds; the remaining gap (published but untagged) fails loudly on the
next run instead of hiding.

**Alternatives.** Keeping the tag trigger and accepting that releases are
owner-only; `changesets` or `release-please` (a Release PR bot — more
machinery than a package releasing every few weeks needs); having the
main-push workflow only create a tag and let the existing tag workflow
publish — this does not work at all, because a tag pushed with
`GITHUB_TOKEN` does not trigger workflows.

**Trade-off.** The tag push was the last manual gate before an
irreversible npm publish, and it is gone. A wrong version number in a
merged PR now publishes immediately. What is left standing in its place is
PR review plus `pnpm verify` running before the publish step — weaker than
a human pausing at the tag, and accepted deliberately for the automation.

**Revisit when.** A bad version reaches npm this way, or the release
cadence slows enough that the manual gate costs nothing.

---

## JS-014 — The non-throwing check catches `validate` rather than re-deriving it

**Shipped:** 0.6.0 (2026-08-08)

**Context.** `validateUrl` throws and `HostPolicy.allows()` covers only the
host, so a caller deciding "should I even try this URL" — which links a
crawler enqueues, which of a batch to report as rejected — had no
policy-shaped API. AskLinq's crawler wrote `target.hostname !==
base.hostname` instead, which disagrees with `sameSitePolicy`: its
`www.`-stripping means apex ↔ `www` links the fetch guard *would* allow
were dropped before they were ever tried.

**Decision.** Add `checkUrl` (returning `{ allowed, url | error }`) and
`isUrlAllowed`, plus `UrlPolicy.check()`. Implement them by **catching
`validate`**, not by re-deriving the checks.

**The implementation choice is the decision.** A second implementation is
free to drift, and a predicate that disagrees with the guard is worse than
no predicate — it makes callers confident about the wrong answer. This is
the same failure shape as the 0.1.2 bypass, where a separately written
URL-collection filter drifted from the scheme check downstream. A test
asserts the two agree across a matrix of inputs, so the property is pinned
rather than merely intended.

**Alternatives.** A boolean-only API (loses the reason, which callers want
for logging); returning `null` for rejection (same loss); duplicating the
checks in a branch-free form for speed (the drift risk, for a cost nobody
had measured).

**Trade-off.** Every rejected URL constructs and throws an exception
internally, which is slower than a plain comparison. For crawler-scale
link filtering that is irrelevant, and it buys the guarantee that the
predicate and the guard can never disagree.

**Revisit when.** A caller profiles this as a real cost — at which point
the fix is memoising per policy, not a second implementation.

---

## JS-015 — `maxBytes` blocks rather than truncates

**Shipped:** 0.6.0 (2026-08-08)

**Context.** Both AskLinq call sites capped response size themselves,
*after* `await res.text()` had already pulled the whole body
(`BRIDGE_RESPONSE_MAX_CHARS`, `MAX_BODY_CHARS`). That is a display
convenience, not a control: the bytes already crossed the wire, so an
endpoint that streams without end still exhausts the caller.

**Decision.** A `maxBytes` option on `guardedFetch` and `safeFetch`,
enforced in **two** places because either alone is insufficient — an
oversized `Content-Length` is rejected before a byte is read, and a
streaming byte count catches bodies that omit or understate it. Exceeding
it raises `SsrfGuardError` with a new `blocked_response_size` reason.

**Blocking, not truncating.** A caller handed a short body with no signal
would treat a partial document as the whole one, turning a size limit into
a correctness bug — and a silent partial read is exactly the kind of thing
that looks fine in tests. Callers who want truncation can catch the error
and choose it explicitly.

**Alternatives.** Truncate and set a flag on the response (a flag nobody
checks is a silent truncation with extra steps); `Content-Length` only
(trivially defeated by omitting the header); buffering the whole body and
checking afterwards (that is the workaround this replaces).

**Trade-off.** A capped response is a **new** `Response` object, so `url`,
`redirected`, and `type` are lost — mitigated by `onFinalUrl`
([JS-009](#js-009--onfinalurl-instead-of-relying-on-responseurl)), which is
more reliable than `Response.url` anyway. Adding to `BlockReason` also
breaks consumers who switch over it exhaustively, hence the minor bump.
And an invalid `maxBytes` throws `TypeError` before the request rather than
being coerced: a `NaN` from `Number(process.env.X)` would otherwise compare
false against every size and disable the cap without saying so.

**Revisit when.** Callers need a truncating mode often enough that
catching the error is real friction — then it is a separate, explicitly
named option, not a change to this one.

## JS-016 — A guard may not depend on the host honouring a hook

**Shipped:** 0.6.1 (2026-08-08)

**Context.** `safeFetch`'s pinned mode enforced the private-IP rule inside
the callback passed to `undici`'s `Agent({ connect: { lookup } })`, and
deliberately skipped the pre-connect check because the connector was
expected to cover it — one resolution shared by the check and the socket,
which is the whole point of pinning ([JS-005](#js-005--dns-pinning-via-an-optional-undici-peer-dependency)).

Bun 1.3.3 accepts that option and never calls the callback. Neither check
ran. With a live listener on loopback, `safeFetch` on Bun returned
HTTP 200 for a host resolving to `127.0.0.1` — the exact request the
library exists to refuse. Node and Deno honour the hook and were never
affected.

Two things made it worse than a runtime quirk. It was the **default**:
`pinDns` unset pins whenever `undici` is installed, so nobody had to opt
in to lose the guard. And it **inverted the hardening option** — passing
`pinDns: true`, the thing a careful caller reaches for, was the most
reliable way to turn the private-IP check off.

It was also invisible to the test suite. Every pinned test passed on Node
precisely *because* Node calls the hook. A suite that only runs where the
hook works cannot observe a bug that only exists where it does not.

**Decision.** The pre-connect DNS validation runs in **every** mode,
pinned or not. Pinning is now strictly additive: where the runtime honours
the hook it still collapses check and connection onto one resolution and
closes the rebinding window; where it does not, the private-IP guard holds
anyway.

The general rule, which is why this has a decision entry rather than a
changelog line: **a security control may not be the only copy of itself
when it lives in someone else's callback.** Optional hooks are requests to
a host, not guarantees from it. A host that ignores one is not a bug we
can detect from the inside — the callback simply never fires, which is
indistinguishable from a request that had no need of it.

**Cost.** One extra DNS resolution per hop on runtimes that do honour
pinning, since the address is now looked up twice. That is the price of
the guarantee not being contingent, and it is what unpinned mode already
paid. Resolver caching absorbs most of it.

**Alternatives.** Probe at startup whether the hook fires and fail closed
if not (a network round trip on first use, and a probe that has to model
every runtime's behaviour); refuse to pin on runtimes known to ignore it
(a denylist that is wrong the moment Bun fixes it, or the next runtime
appears); leave it and document Bun as unsupported (the failure is silent
and the default is on — documentation does not reach the person who never
read it).

**Testing.** The regression test mocks `undici` with an `Agent` that
accepts `connect.lookup` and ignores it, reproducing the hostile runtime
inside the Node suite. It asserts the block still happens with
`pinDns: true`, with automatic pinning, and on a redirect hop — and
asserts that the stub was actually handed a hook, so the test cannot pass
for the wrong reason.

**Revisit when.** Bun starts honouring `connect.lookup`. Even then the
pre-connect check stays: the point is that the guarantee does not depend
on which runtime is underneath.

---

## JS-018 — `singleHostPolicy` locks the origin, port included

**Shipped:** 0.7.0 (2026-08-08)

**Context.** `sameSitePolicy` strips a leading `www.` and matches by
suffix, because it exists for "crawl the site the user just submitted"
([JS-007](#js-007--samesitepolicy-strips-a-leading-www)). A caller with a
*known* endpoint — a registered API base, a webhook target — wants the
opposite and had to write the policy by hand. AskLinq's bridge does
exactly that in `bridge/execute.ts`.

**Decision.** A sibling helper that locks the **origin**: scheme, host,
and port. No `www.` peer, no subdomains. Two named helpers for two
intents, so the choice is visible at the call site rather than encoded in
whichever fields someone remembered to set.

**Locking the port is the substance of it.** The default `allowedPorts`
is `[-1, 80, 443]`, so the hand-written version everyone writes —
`{ exactHosts: [new URL(base).hostname] }` — **rejects its own base URL**
when that base has a non-standard port. It fails quietly, only on the
deployments that use one, and looks like an unrelated connectivity
problem. The helper derives the port from the base URL, and reuses
`defaultPortForScheme` from `policy.ts` rather than re-deriving the
scheme-default table: two copies of that mapping would be free to
disagree, and the symptom would be precisely this bug
([JS-014](#js-014--the-non-throwing-check-catches-validate-rather-than-re-deriving-it)
again, in a different place).

**Alternatives.** An option on `sameSitePolicy` (`{ exact: true }`) — one
function with a flag that inverts its matching rule is harder to read at
the call site than two names; deriving from an origin string rather than a
URL (callers hold base URLs with paths, so this just moves the parsing).

**Trade-off.** Overrides are additive for `exactHosts`/`suffixes`, so
passing them **widens** the lock. That is consistent with
`sameSitePolicy` and with the package's fail-closed stance, but it means
"single host" describes the default, not a guarantee the caller cannot
undo.

**Revisit when.** Callers need an origin lock that overrides cannot
widen — then it is a separate, explicitly named constructor, not a flag.

---

## JS-019 — The Hono adapter is typed structurally and tested against real Hono

**Shipped:** 0.7.0 (2026-08-08)

**Context.** The framework adapters were Express and Vite, while the one
production consumer runs Hono on Cloudflare Workers — the runtime the
`guardedFetch` half of this package exists for — and called the guard by
hand in every route.

**Decision.** `createHonoUrlGuard` on its own entry point (`./hono`), so
nothing lands in the root bundle. Typed against the *shape* of a Hono
context (`MinimalHonoContext`) rather than importing Hono, matching what
`express.ts` and `vite.ts` already do: the package keeps zero
dependencies, and anything with the same shape works.

**And tested against real Hono, in a second file.** Structural typing
buys independence at the cost of a guess: the interface is my model of
Hono, and a model can be wrong while every test that uses it passes. That
is not a hypothetical here — it is what 0.6.1 was
([JS-016](#js-016--a-guard-may-not-depend-on-the-host-honouring-a-hook)),
where the suite only ever ran where the assumed hook existed. So `hono.ts`
is driven twice: once through a fake that proves the middleware does what
it says, once through real Hono that proves the assumptions hold. The one
that mattered was body caching — the middleware reads the body, and the
handler must still be able to read it. Hono does cache. That is now
verified rather than believed.

**Multipart bodies are deliberately not scanned.** `application/json`
(and `+json`) and `application/x-www-form-urlencoded` are; parsing
`multipart/form-data` would buffer uploaded files inside a check that runs
on every request, turning a safety control into a memory cost. The gap is
stated in the README, in the source, and pinned by a test, because an
unstated gap in a guard is worse than a stated one — it reads as coverage.

**Alternatives.** Importing Hono as a peer dependency (types would be
exact, at the cost of a dependency and version coupling for everyone,
including the majority who never touch this entry point); scanning every
body type (the multipart cost); no adapter at all and leaving consumers to
call `guardToolInput` per route — which is what they were doing, once per
route, differently each time.

**Trade-off.** A structural type can drift from Hono's real one across
major versions without a compile error anywhere — the real-Hono test file
is what would catch that, and it only catches it for the Hono version in
`devDependencies`.

**Revisit when.** Hono changes its context shape, or a consumer needs
multipart scanning badly enough to accept the cost — the latter being a
separate opt-in option, not a change to the default.
