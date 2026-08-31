import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = path.join(root, 'docs', 'assets', 'brand');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const asset = (relative) => path.join(brandDir, relative);

function expect(value, expected, message) {
  if (!value.includes(expected)) throw new Error(`${message}: expected ${JSON.stringify(expected)}`);
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

const [readme, readmeKo, workersReadme, workersReadmeKo, site, siteKo, checksums, packageJson] = await Promise.all([
  read('README.md'),
  read('README.ko.md'),
  read('examples/workers/README.md'),
  read('examples/workers/README.ko.md'),
  read('site/index.html'),
  read('site/ko/index.html'),
  readFile(asset('checksums.txt'), 'utf8'),
  read('package.json'),
]);

const packageManifest = JSON.parse(packageJson);
const rolloutContractFailures = [];
function requireRolloutContract(condition, message) {
  if (!condition) rolloutContractFailures.push(message);
}

requireRolloutContract(
  packageManifest.scripts?.verify?.includes('pnpm check:brand'),
  'root verify command must run pnpm check:brand',
);

const expectedAssets = new Map(
  checksums.trim().split(/\r?\n/).map((line) => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`invalid O03 checksum entry: ${line}`);
    return [match[2], match[1]];
  }),
);

if (expectedAssets.size === 0) throw new Error('O03 checksums are empty');
for (const [relative, expectedHash] of expectedAssets) {
  const file = asset(relative);
  await access(file);
  const actualHash = await sha256(file);
  if (actualHash !== expectedHash) throw new Error(`checksum mismatch for docs/assets/brand/${relative}`);
}

const core = await readFile(asset('glyph-color.svg'), 'utf8');
expect(core, 'data-oss-project="O03"', 'O03 registry id');
expect(core, 'data-layer="q-frame"', 'shared Q frame');
expect(core, '<rect x="5" y="5" width="16" height="16" rx="2"', 'rear Q frame');
expect(core, '<rect x="11" y="11" width="16" height="16" rx="2"', 'front Q frame');
expect(core, 'data-layer="product-route"', 'O03 product route');
expect(core, 'M13 18H17', 'O03 protected boundary input');
expect(core, 'M21 14V22', 'O03 protected boundary bar');
if (core.includes('data-runtime-layer')) throw new Error('runtime attachment must not be inside the shared security glyph');

const lockup = await readFile(asset('lockup.svg'), 'utf8');
expect(lockup, 'data-oss-lockup="O03"', 'O03 runtime lockup registry id');
expect(lockup, 'data-runtime-layer="neutral"', 'O03 neutral runtime layer');
expect(lockup, 'data-runtime-label="JavaScript implementation"', 'O03 JavaScript runtime label');

const localizedPages = [
  [
    'site/index.html',
    site,
    'ssrf-guard-js | Open source by DevsLab',
    'Open source by DevsLab',
    'https://devslab-kr.github.io/ssrf-guard-js/og.png',
  ],
  [
    'site/ko/index.html',
    siteKo,
    'ssrf-guard-js | DevsLab 오픈소스',
    'DevsLab 오픈소스',
    'https://devslab-kr.github.io/ssrf-guard-js/og.png',
  ],
];
for (const [page, html, title, endorsement, ogImage] of localizedPages) {
  expect(html, `<title>${title}</title>`, `${page} localized title`);
  expect(html, `<meta property="og:title" content="${title}"`, `${page} Open Graph title`);
  expect(html, `content="${ogImage}"`, `${page} Open Graph image`);
  expect(html, '<meta property="og:image:width" content="1200"', `${page} Open Graph image width`);
  expect(html, '<meta property="og:image:height" content="630"', `${page} Open Graph image height`);
  expect(html, '<meta property="og:image:alt"', `${page} Open Graph image alt text`);
  expect(html, '<meta name="twitter:card" content="summary_large_image"', `${page} Twitter card`);
  expect(html, 'rel="icon" href="', `${page} favicon metadata`);
  expect(html, 'rel="apple-touch-icon" href="', `${page} Apple touch metadata`);
  expect(html, 'https://devslab.kr/brand/open-source/', `${page} canonical OSS brand link`);
  expect(html, endorsement, `${page} localized endorsement`);
  expect(html, 'hero-atmosphere', `${page} project atmosphere`);
  expect(html, 'data-atmosphere="project"', `${page} project atmosphere variant`);
  requireRolloutContract(
    /@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?\.hero-atmosphere__glow\s*\{[\s\S]*?background:\s*radial-gradient\([^)]*rgb\(103 232 249 \/ 0\.10\)/.test(html),
    `${page} dark-mode atmosphere must use a direct cyan 0.10 gradient stop`,
  );
  requireRolloutContract(
    /<a class="brand-link" href="https:\/\/devslab\.kr\/brand\/open-source\/" aria-label="[^"]+">\s*<img class="brand-mark"[^>]*>\s*<strong>ssrf-guard-js<\/strong>\s*<\/a>/.test(html),
    `${page} must link the visible O03 mark and project label to the OSS brand guide`,
  );
}

if (rolloutContractFailures.length > 0) {
  throw new Error(`OSS rollout contract failures:\n- ${rolloutContractFailures.join('\n- ')}`);
}

for (const [relative, source] of [
  ['site/favicon.svg', 'favicon.svg'],
  ['site/favicon.ico', 'favicon.ico'],
  ['site/apple-touch-icon.png', 'apple-touch-icon.png'],
  ['site/og.png', 'og.png'],
]) {
  const file = path.join(root, relative);
  await access(file);
  if ((await sha256(file)) !== expectedAssets.get(source)) throw new Error(`${relative} must match vendored O03 ${source}`);
}

for (const [contents, endorsement, header] of [
  [readme, 'Open source by DevsLab', 'docs/assets/brand/readme-header.png'],
  [readmeKo, 'DevsLab 오픈소스', 'docs/assets/brand/readme-header.png'],
]) {
  expect(contents, header, 'README O03 header');
  expect(contents, '# ssrf-guard-js', 'README visible project H1');
  expect(contents, endorsement, 'README endorsement');
  expect(contents, 'https://devslab.kr/brand/open-source/', 'README canonical OSS brand link');
}
for (const [contents, endorsement] of [
  [workersReadme, 'Open source by DevsLab'],
  [workersReadmeKo, 'DevsLab 오픈소스'],
]) {
  expect(contents, endorsement, 'Workers README endorsement');
  expect(contents, 'https://devslab.kr/brand/open-source/', 'Workers README canonical OSS brand link');
  if (contents.includes('docs/assets/brand/')) throw new Error('Workers example README must not include an independent glyph');
}

console.log(`check:brand: verified O03 shared core, runtime lockup, metadata, and ${expectedAssets.size} checksummed assets`);
