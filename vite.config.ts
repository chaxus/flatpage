import { defineConfig, type Plugin } from 'vite';
import { MESSAGES, LOCALES, type Locale, type Messages } from './src/i18n';

// 部署目标可配置：GitHub Pages 挂在 /flatpage/ 子路径，自定义域名挂在根路径。
// 写死任何一个都会让另一个的资源路径和 canonical 全部错位。
const BASE = process.env.FLATPAGE_BASE || '/';
const ORIGIN = (process.env.FLATPAGE_ORIGIN || 'https://flat.bybrowser.com').replace(/\/$/, '');
// 同样内容部署在多处时，只有正式入口该被索引；其余（GitHub Pages 的演示页）
// 必须 noindex，否则两边 canonical 各指自己，是重复内容、互相稀释。
const NOINDEX = process.env.FLATPAGE_NOINDEX === '1';
const PATH: Record<Locale, string> = { en: BASE, zh: `${BASE}zh/` };
const urlOf = (lang: Locale): string => ORIGIN + PATH[lang];

/**
 * 构建时把双语文案渲染进 HTML。
 *
 * 不做这一步，搜索引擎看到的就是一个 <h1> 空标签的空壳 —— 文案全靠 JS 注入，
 * 对一个靠自然搜索获客的工具站等于没有内容。中文版更是压根不存在。
 * 所以两种语言各出一份静态 HTML，互相 hreflang。
 */
function renderI18n(): Plugin {
  return {
    name: 'flatpage-i18n-prerender',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const entry = Object.keys(bundle).find((k) => k.endsWith('index.html'));
      if (!entry) throw new Error('找不到 index.html');
      const asset = bundle[entry];
      if (!asset || asset.type !== 'asset') throw new Error('index.html 不是 asset');
      const base = String(asset.source);

      for (const lang of LOCALES) {
        // 字典完整性由类型系统保证（Record<Locale, Messages>），不需要运行时 validate
        const t = (k: keyof Messages): string => MESSAGES[lang][k];
        const esc = (v: string): string =>
          v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const escAttr = (v: string): string => esc(v).replace(/"/g, '&quot;');

        let html = base;
        // 填充所有 data-i18n 的空元素
        // 标签名要允许连字符：自定义元素（r-button / r-checkbox）都带连字符，
        // 只匹配 [a-zA-Z0-9]+ 会把它们整批漏掉，按钮在 JS 加载前就是一排空白。
        html = html.replace(
          /(<([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)data-i18n="([^"]+)"([^>]*?)>)(<\/\2>)/g,
          (_m: string, open: string, _tag: string, _a: string, key: string,
           _b: string, close: string) => open + esc(t(key as keyof Messages)) + close,
        );
        html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(t('meta.title'))}</title>`);
        html = html.replace(
          /(<meta name="description" content=")[^"]*(")/,
          `$1${escAttr(t('meta.desc'))}$2`,
        );
        html = html.replace(/(<meta property="og:title" content=")[^"]*(")/,
          `$1${escAttr(t('meta.title'))}$2`);
        html = html.replace(/(<meta property="og:description" content=")[^"]*(")/,
          `$1${escAttr(t('meta.desc'))}$2`);
        html = html.replace(/<html lang="[^"]*"/, `<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}"`);
        if (NOINDEX) {
          html = html.replace(/(<meta name="robots" content=")[^"]*(")/, '$1noindex,follow$2');
        }
        html = html.replace(/("url"\s*:\s*")[^"]*(")/, `$1${urlOf('en')}$2`);

        const self = urlOf(lang);
        html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${self}$2`);
        html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${self}$2`);

        const alts = LOCALES.map((l) =>
          `<link rel="alternate" hreflang="${l === 'zh' ? 'zh-Hans' : 'en'}" href="${urlOf(l)}">`
        ).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${urlOf('en')}">`;
        html = html.replace('</head>', alts + '\n</head>');

        // 语言切换按钮变成真链接，让爬虫能顺着爬到另一语言版本
        const other = lang === 'zh' ? 'en' : 'zh';
        html = html.replace(
          /<button class="ghost" id="langBtn"[^>]*>[\s\S]*?<\/button>/,
          `<a class="ghost" id="langBtn" href="${PATH[other]}" hreflang="${other === 'zh' ? 'zh-Hans' : 'en'}">${other === 'zh' ? '中文' : 'EN'}</a>`,  // PATH 已含 BASE
        );

        if (lang === 'en') asset.source = html;
        else this.emitFile({ type: 'asset', fileName: 'zh/index.html', source: html });
      }
    },
  };
}

function seoFiles(): Plugin {
  return {
    name: 'flatpage-seo-files',
    apply: 'build',
    generateBundle() {
      const now = new Date().toISOString().slice(0, 10);
      const urls = LOCALES.map((l) => `  <url>
    <loc>${urlOf(l)}</loc>
    <lastmod>${now}</lastmod>
${LOCALES.map((a) => `    <xhtml:link rel="alternate" hreflang="${a === 'zh' ? 'zh-Hans' : 'en'}" href="${urlOf(a)}"/>`).join('\n')}
  </url>`).join('\n');
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
` });
      this.emitFile({ type: 'asset', fileName: 'robots.txt',
        source: NOINDEX
          ? 'User-agent: *\nDisallow: /\n'
          : `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}${BASE}sitemap.xml\n` });
    },
  };
}


/**
 * Service Worker + PWA + 真 404。
 *
 * 首页写着「关掉 Wi-Fi 它照样能用」。没有 SW 的话这是假的 —— 刷新就白屏。
 *
 * 缓存策略分两层，因为 wasm 有 1.8MB：
 *   shell（HTML/CSS/JS，约 30KB）  install 时 precache，首屏代价可忽略
 *   wasm                          第一次真正用到时才缓存，不拖慢首次访问
 * 于是「用过一次之后完全离线可用」，而不是「首次访问就先下 1.8MB」。
 */
function offlineSupport(): Plugin {
  let swRef = '';
  return {
    name: 'flatpage-offline',
    apply: 'build',
    enforce: 'post',

    // SW 要 import ranuts/sw，所以必须作为真正的 chunk 打包，
    // 不能再像以前那样在 generateBundle 里拼字符串。
    buildStart() {
      swRef = this.emitFile({
        type: 'chunk',
        id: new URL('./src/sw.ts', import.meta.url).pathname,
        fileName: 'sw.js',
      });
    },

    generateBundle(_opts, bundle) {
      void swRef;
      const shell: string[] = [BASE, `${BASE}zh/`, `${BASE}favicon.svg`];
      for (const name of Object.keys(bundle)) {
        // wasm 不进 precache：1.8MB，等真的用到再缓存
        // sw.js 自己也不进，否则它会缓存住旧版自己
        if (name.endsWith('.wasm') || name.endsWith('.html') || name === 'sw.js') continue;
        shell.push(BASE + name);
      }
      // 缓存名带内容指纹，资源一变就换缓存，旧的在 activate 里清掉
      const version = Object.keys(bundle).filter((n) => !n.endsWith('.html')).sort().join('|');
      let h = 0;
      for (let i = 0; i < version.length; i++) h = (h * 31 + version.charCodeAt(i)) | 0;
      const cache = `flatpage-${(h >>> 0).toString(36)}`;

      // 清单单独出一份：打包完成才知道最终文件名，SW 运行时读它
      this.emitFile({
        type: 'asset',
        fileName: 'precache.json',
        source: JSON.stringify({ cache, shell }, null, 2),
      });

      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify({
        name: 'FlatPage', short_name: 'FlatPage',
        description: 'Flatten curved photos of documents, entirely in your browser.',
        start_url: BASE, scope: BASE, display: 'standalone',
        background_color: '#ffffff', theme_color: '#0a0a0a',
        icons: [{ src: `${BASE}favicon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      }, null, 2) });

      // CF Pages 默认把未匹配路径 fallback 成 index.html + 200，
      // 于是任意 URL 都是「有效页面」—— soft 404。放 404.html 让它返回真 404。
      this.emitFile({ type: 'asset', fileName: '404.html', source: `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Not found — FlatPage</title>
<style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#0a0a0a;text-align:center}
@media(prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}}
a{color:inherit}main{padding:24px}h1{font-size:20px;margin:0 0 8px;font-weight:600}
p{color:#666;margin:0 0 20px}@media(prefers-color-scheme:dark){p{color:#a1a1a1}}</style>
</head><body><main>
<h1>404</h1>
<p>This page does not exist.<br>此页面不存在。</p>
<a href="${BASE}">FlatPage</a> · <a href="${BASE}zh/">中文</a>
</main></body></html>
` });

      // sw.js 和清单绝不能被长期缓存，否则新版本推不下去
      this.emitFile({ type: 'asset', fileName: '_headers', source: `/sw.js
  Cache-Control: no-cache
/precache.json
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
` });
    },
  };
}

export default defineConfig({
  base: BASE,
  define: { __BASE__: JSON.stringify(BASE) },
  plugins: [renderI18n(), seoFiles(), offlineSupport()],
  build: { assetsInlineLimit: 0 },
});
