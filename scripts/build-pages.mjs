import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.pages');
const siteDir = path.join(root, 'site');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(siteDir, outDir, { recursive: true });

// Every page, not just the root one: the translations live in
// subdirectories (site/ko/), and a page that missed this substitution
// renders the literal `v__PACKAGE_VERSION__` to readers.
let substituted = 0;
for (const entry of await readdir(siteDir, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
  const rel = path.relative(siteDir, path.join(entry.parentPath ?? entry.path, entry.name));
  const filePath = path.join(outDir, rel);
  const html = await readFile(filePath, 'utf8');
  await writeFile(filePath, html.replaceAll('__PACKAGE_VERSION__', pkg.version));
  substituted += 1;
}
if (substituted === 0) throw new Error('no HTML pages found under site/');
console.log(`build-pages: ${substituted} page(s) stamped with v${pkg.version}`);

await writeFile(
  path.join(outDir, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version }, null, 2),
);
