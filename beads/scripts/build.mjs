// randolf.dev adaptation, 2026. Upstream is kept intact; all changes are applied
// to a disposable working copy so upgrades and local modifications are auditable.
import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import zhCN from '../upstream/src/i18n/zh-CN.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, '.work');
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
const excluded = new Set(['node_modules', 'dist', 'release', 'test-results', 'playwright-report', '.git']);
await cp(join(root, 'upstream'), work, { recursive: true, filter: path => !path.split('/').some(part => excluded.has(part)) });
async function edit(path, transform) {
  const target = join(work, path);
  const before = await readFile(target, 'utf8');
  let after = transform(before);
  if (after === before) throw new Error(`Adaptation did not apply: ${path}`);
  const notice = 'Modified for randolf.dev (2026); see NOTICE.txt and beads/scripts/build.mjs.';
  if (/\.(?:js|css)$/.test(path)) after = `/* ${notice} */\n${after}`;
  if (/\.html$/.test(path)) after = `<!-- ${notice} -->\n${after}`;
  await writeFile(target, after);
}
function replace(text, from, to) {
  if (!text.includes(from)) throw new Error(`Upstream changed: ${from}`);
  return text.replace(from, to);
}
const siteUrl = 'https://randolf.dev/beads/';
const navigation = await readFile(join(root, 'site/navigation.html'), 'utf8');
const theme = await readFile(join(root, 'site/theme.css'), 'utf8');
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
await edit('index.html', html => {
  html = html.replaceAll('https://zwhy149.github.io/bead-grid-studio/', siteUrl)
    .replace(/\s*<link rel="alternate"[^>]+>/g, '')
    .replace('<html lang="en">', '<html lang="zh-CN">')
    .replace('content="light"', 'content="dark"').replace('content="#fbfaf7"', 'content="#0a0a0c"')
    .replace(/^[ \t]*<div class="language-switcher"[\s\S]*?<\/div>\n/m, '')
    .replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src data: blob:; worker-src 'self' blob:; object-src 'none'; form-action 'none'; base-uri 'self'">`)
    .replace('<body>', `<body>\n${navigation}`)
    .replace('Untitled pattern', '未命名图纸').replace('Images are processed only in this browser', '图片仅在当前浏览器中处理')
    .replace('>IMG<', '>图<').replace('>GitHub<', '>上游源码<')
    .replace('>Apache-2.0<', '>开源许可证<')
    .replace('href="https://github.com/zwhy149/bead-grid-studio/releases/latest"', 'href="./offline.html" download="拼豆图纸生成器-离线版.html"')
    .replace('<div class="product-links">', '<p class="site-attribution">基于 <a href="https://github.com/zwhy149/bead-grid-studio" target="_blank" rel="noopener noreferrer">豆格工坊</a> 完整应用移植，由 randolf.dev 适配。© 2026 Bead Grid Studio contributors。代码采用 Apache-2.0 许可证，色板与第三方版权声明随应用保留。</p><div class="product-links">');
  // Render translated markup at build time as well, preventing an English flash.
  html = html.replace(/(<[^>]+\bdata-i18n="([^"]+)"[^>]*>)([^<]*)(<\/[^>]+>)/g,
    (all, start, key, text, end) => typeof zhCN[key] === 'string' ? start + escape(zhCN[key]) + end : all);
  for (const [key, attribute] of [['aria', 'aria-label'], ['title', 'title'], ['placeholder', 'placeholder'], ['alt', 'alt']]) {
    html = html.replace(new RegExp(`<[^>]+data-i18n-${key}="([^"]+)"[^>]*>`, 'g'), (tag, id) =>
      typeof zhCN[id] === 'string' ? tag.replace(new RegExp(`${attribute}="[^"]*"`), `${attribute}="${escape(zhCN[id])}"`) : tag);
  }
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${zhCN['meta.title']} · RANDOLF</title>`)
    .replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*/, `$1${zhCN['meta.description']}`)
    .replace(/(<meta (?:name|property)="(?:og:title|twitter:title)" content=")[^"]*/, `$1${zhCN['meta.title']}`)
    .replace('content="en_US"', 'content="zh_CN"')
    .replace('content="Bead Grid Studio original image to fuse bead pattern preview"', 'content="图片转换为拼豆图纸的预览"');
  return '<!-- Adapted for randolf.dev in 2026; upstream copyright and licenses retained. -->\n' + html;
});
await edit('src/i18n/index.js', text => {
  text = replace(text, "export const DEFAULT_LOCALE = 'en-US';", "export const DEFAULT_LOCALE = 'zh-CN';")
    .replace('let activeLocale = queryLocale() || storedLocale() || browserLocale();', "let activeLocale = 'zh-CN';")
    .replace('const normalized = normalizeLocale(locale);', "const normalized = 'zh-CN';")
    .replaceAll("'[data-locale]'", "'button[data-locale]'")
    .replace("useEnglish ? './privacy.en.html' : './privacy.html'", "location.protocol === 'file:' ? 'https://randolf.dev/beads/privacy.html' : './privacy.html'")
    .replace("useEnglish ? './terms.en.html' : './terms.html'", "location.protocol === 'file:' ? 'https://randolf.dev/beads/terms.html' : './terms.html'")
    .replaceAll('https://zwhy149.github.io/bead-grid-studio/', siteUrl);
  return '// randolf.dev: fixed Simplified Chinese, including saved preferences and shared URLs.\n' + text;
});
await edit('src/i18n/zh-CN.js', text => text.replace("'action.star': 'GitHub Star'", "'action.star': '关注上游项目'")
  .replace("const zhCN = {", "const zhCN = {\n  'status.tool.brush': '画笔工具 · 点击或拖动绘制',\n  'status.tool.eraser': '橡皮工具 · 点击或拖动擦除',\n  'status.tool.picker': '取色工具 · 点击图纸选择颜色',"));
await edit('src/styles.css', text => text + '\n' + theme);
await edit('src/app.js', text => text.replace("const DRAFT_KEY = 'bead-grid-studio:draft:v2';", "const DRAFT_KEY = 'randolf:beads:draft:v2';")
  .replaceAll("'[data-locale]'", "'button[data-locale]'")
  .replace("{action:t(labelKey,labelParams),count:", "{label:t(labelKey,labelParams),count:")
  .replaceAll("'rocket-badge.png'", "'火箭徽章.png'")
  .replace("location.protocol==='https:'&&'serviceWorker' in navigator", "['https:','http:'].includes(location.protocol)&&'serviceWorker' in navigator"));
await edit('public/manifest.webmanifest', text => {
  const manifest = JSON.parse(text);
  Object.assign(manifest, { name: '拼豆图纸生成器 · RANDOLF', short_name: '拼豆', lang: 'zh-CN', description: zhCN['meta.description'], background_color: '#0a0a0c', theme_color: '#0a0a0c' });
  return JSON.stringify(manifest, null, 2) + '\n';
});
for (const name of ['privacy', 'terms']) {
  await edit(`public/${name}.html`, html => html.replace(/<span><strong>中文[\s\S]*?<\/span>/, '<a href="../">网站首页</a>')
    .replace('社区版 1.2.0 · 更新于 2026-08-26', '上游社区版 1.3.0 · randolf.dev 本地适配版')
    .replace('← 返回豆格工坊', '← 返回拼豆工具'));
}
await edit('public/legal.css', text => text + '\n:root { color-scheme: dark; } body { background: #0a0a0c; color: #ececf0; } main { background: #101014; border-color: #30303a; } a { color: #c9f44d; } .meta { color: #b0b0bc; } .notice { background: #2a3418; color: #ececf0; border-color: #555563; }\n');
await edit('public/404.html', html => html.replace('lang="en"', 'lang="zh-CN"').replaceAll('Page Not Found', '页面不存在').replace('The requested page could not be found or has moved.', '找不到此页面，请返回拼豆工具。').replace('Back to Bead Grid Studio', '返回拼豆工具'));
await edit('public/robots.txt', () => `User-agent: *\nAllow: /beads/\nSitemap: ${siteUrl}sitemap.xml\n`);
await edit('public/sitemap.xml', () => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['', 'privacy.html', 'terms.html'].map(path => `<url><loc>${siteUrl}${path}</loc></url>`).join('')}</urlset>\n`);
await edit('NOTICE', text => text + '\nrandolf.dev adaptation (2026): Simplified Chinese interface, site navigation,\ndark theme, local offline download, scoped cache and reproducible static build.\nUpstream source: https://github.com/zwhy149/bead-grid-studio\nPinned commit: f3d8c261f7005a2f619d3db6061ce3649a59720e\n');
await cp(join(work, 'NOTICE'), join(work, 'public/NOTICE.txt'));
await build({ configFile: join(work, 'vite.config.js'), root: work });
// Content-derived cache name also refreshes offline installations after UI-only updates.
const dist = join(work, 'dist');
const builtHtml = await readFile(join(dist, 'index.html'));
const version = createHash('sha256').update(builtHtml).digest('hex').slice(0, 16);
const sw = (await readFile(join(dist, 'sw.js'), 'utf8'))
  .replace("'bead-grid-studio-community-'", "'randolf-beads-'")
  .replace('`${CACHE_PREFIX}v1.3.0`', '`' + '${CACHE_PREFIX}' + version + '`')
  .replace("  './privacy.en.html',\n", '').replace("  './terms.en.html',\n", '')
  .replace("  './manifest.webmanifest',", "  './manifest.webmanifest',\n  './offline.html',")
  .replace('if (url.origin !== self.location.origin) return;', 'if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;');
await writeFile(join(dist, 'sw.js'), sw);
// Upstream portable builder inlines the complete app, CSS and required licenses.
execFileSync(process.execPath, [join(work, 'scripts/build-portable.mjs')], { cwd: work, stdio: 'inherit' });
let portable = await readFile(join(work, 'release/bead-grid-studio-v1.3.0.html'), 'utf8');
portable = portable.replaceAll('https://zwhy149.github.io/bead-grid-studio/', siteUrl)
  .replaceAll('href="../', 'href="https://randolf.dev/')
  .replace('href="./" aria-current="page"', `href="${siteUrl}" aria-current="page"`)
  .replace('href="./offline.html"', `href="${siteUrl}offline.html"`);
await writeFile(join(dist, 'offline.html'), portable);
// Retain only Chinese user-facing legal pages in the published app.
for (const name of ['privacy.en.html', 'terms.en.html']) await rm(join(dist, name));
// Delete only previously generated hashed assets; source and tests are never build targets.
await rm(join(root, 'assets'), { recursive: true, force: true });
for (const entry of await readdir(dist)) await cp(join(dist, entry), join(root, entry), { recursive: true });
console.log(`Published complete application to ${root} (cache ${version})`);
