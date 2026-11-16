import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const published = [
  '404.html',
  'LICENSE.txt',
  'NOTICE.txt',
  '_headers',
  'app-icon-192.png',
  'app-icon-512.png',
  'app-icon.svg',
  'healthz.json',
  'legal.css',
  'manifest.webmanifest',
  'privacy.en.html',
  'privacy.html',
  'robots.txt',
  'sitemap.xml',
  'social-preview.png',
  'sw.js',
  'terms.en.html',
  'terms.html',
  'version.json',
];

await rm(dist, { recursive: true, force: true });
await cp(join(root, 'index.template.html'), join(root, 'index.html'));
await build({
  root,
  configFile: join(root, 'vite.config.js'),
});

for (const name of published) {
  await cp(join(root, 'public', name), join(dist, name), { recursive: true });
}

const html = await readFile(join(dist, 'index.html'), 'utf8');
const cssAsset = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/)?.[1];
const jsAsset = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/)?.[1];
if (!cssAsset || !jsAsset) throw new Error('Built application assets were not found.');

const [css, js, license, notices] = await Promise.all([
  readFile(join(dist, cssAsset.replace(/^\.\//, '')), 'utf8'),
  readFile(join(dist, jsAsset.replace(/^\.\//, '')), 'utf8'),
  readFile(join(root, 'LICENSE.txt'), 'utf8'),
  readFile(join(root, 'NOTICE.txt'), 'utf8'),
]);
const portable = html
  .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, `<style>${css}</style>`)
  .replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, `<script type="module">${js}</script>`)
  .replace('</body>', `<details class="portable-licenses"><summary>许可证与版权声明</summary><pre>${escapeHtml(license)}</pre><pre>${escapeHtml(notices)}</pre></details></body>`);
await writeFile(join(dist, 'offline.html'), portable);

await rm(join(root, 'assets'), { recursive: true, force: true });
await mkdir(join(root, 'assets'), { recursive: true });
for (const entry of await readdir(join(dist, 'assets'))) {
  await cp(join(dist, 'assets', entry), join(root, 'assets', entry));
}
for (const name of ['index.html', ...published, 'offline.html']) {
  await cp(join(dist, name), join(root, name), { recursive: true });
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

console.log(`Published standalone beads application to ${root}`);
