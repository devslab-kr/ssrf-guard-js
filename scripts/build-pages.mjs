import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.pages');
const siteDir = path.join(root, 'site');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(siteDir, outDir, { recursive: true });

const indexPath = path.join(outDir, 'index.html');
const index = await readFile(indexPath, 'utf8');
await writeFile(indexPath, index.replaceAll('__PACKAGE_VERSION__', pkg.version));

await writeFile(
  path.join(outDir, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version }, null, 2),
);
