# Publisher attribution

Documentation-only tooling; this dependency is not shipped with the library.

`npm ci --prefix tools/publisher` installs the pinned shared publisher helper.
`npm run sync --prefix tools/publisher` regenerates the marked README and public HTML attribution from `@devslab/site-kit/devslab`.
`npm run check --prefix tools/publisher` detects drift without writing files.

Edit the product URL or repository in `config.json`; update the shared preset in site-kit for company-wide identity changes. Do not hand-edit generated publisher blocks.
