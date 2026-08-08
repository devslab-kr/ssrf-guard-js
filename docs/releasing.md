# Releasing

[한국어](releasing.ko.md)

How a version of `@devslab/ssrf-guard-js` reaches npm. Maintainers only —
this lives in `docs/` rather than the README because the README is the
npmjs.com package page, and release mechanics are noise for the people
installing the package.

Publishing is handled by GitHub Actions. It needs an npm automation token
as the repository secret `NPM_TOKEN`.

## The merge is the release

Open a PR that bumps `version` in `package.json` and adds the matching
`CHANGELOG.md` section. Merging it to `main` runs `Publish to npm`, which
verifies the package, publishes it with provenance, creates the `vX.Y.Z`
tag, and opens a GitHub Release whose notes are that CHANGELOG section:

```bash
npm publish --access public --provenance
```

The gate is the npm registry, not the tag: if the version in
`package.json` is already published the workflow is a quiet no-op, so
ordinary merges do nothing and a re-run can never publish twice.

See [JS-013](decisions.md#js-013--the-merge-is-the-release) for why the
merge is the trigger rather than a hand-pushed tag.

## Pushing a tag by hand

Still works, and does the same thing minus creating the tag:

```bash
git tag v0.7.0
git push origin v0.7.0
```

A hand-pushed tag must match `package.json` — the workflow fails if it
does not, because a tag that disagrees with the manifest is a lie about
what would be published.

## Before bumping the version

- `pnpm verify` green locally — typecheck, the full suite, and the build.
- The runtime matrix is green. CI runs `scripts/runtime-check.mjs` on
  Node, Bun and Deno; it exercises the built `dist/`, which is the only
  place runtime differences show up.
- `CHANGELOG.md` has a section for the new version. The release notes are
  generated from it, so an empty or missing section ships an empty
  release.
- `docs/roadmap.md` and its `.ko.md` twin record what shipped, and any
  decision made along the way is in `docs/decisions.md` (both languages).
- Both `README.md` and `README.ko.md` still describe what is actually
  true of the new version — they are the npm page and its translation.
