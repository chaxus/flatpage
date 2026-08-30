import { defineConfig } from 'vite';
import { STRINGS, validate, LANGS } from './src/i18n.js';

// 部署目标可配置：GitHub Pages 挂在 /flatpage/ 子路径，自定义域名挂在根路径。
// 写死任何一个都会让另一个的资源路径和 canonical 全部错位。
const BASE = process.env.FLATPAGE_BASE || '/';
const ORIGIN = (process.env.FLATPAGE_ORIGIN || 'https://bybrowser.com').replace(/\/$/, '');
const PATH = { en: BASE, zh: BASE + 'zh/' };
const urlOf = (lang) => ORIGIN + PATH[lang];

/**
 * 构建时把双语文案渲染进 HTML。
 *
 * 不做这一步，搜索引擎看到的就是一个 <h1> 空标签的空壳 —— 文案全靠 JS 注入，
 * 对一个靠自然搜索获客的工具站等于没有内容。中文版更是压根不存在。
 * 所以两种语言各出一份静态 HTML，互相 hreflang。
 */
function renderI18n() {
  return {
    name: 'flatpage-i18n-prerender',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      validate();
      const entry = Object.keys(bundle).find((k) => k.endsWith('index.html'));
      if (!entry) throw new Error('找不到 index.html');
      const base = bundle[entry].source;

      for (const lang of LANGS) {
        const t = (k) => {
          const e = STRINGS[k];
          if (!e) throw new Error('未知 key: ' + k);
          return e[lang];
        };
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

        let html = base;
        // 填充所有 data-i18n 的空元素
        html = html.replace(
          /(<([a-zA-Z0-9]+)([^>]*?)data-i18n="([^"]+)"([^>]*?)>)(<\/\2>)/g,
          (_m, open, _tag, _a, key, _b, close) => open + esc(t(key)) + close,
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
        html = html.replace(/("url"\s*:\s*")[^"]*(")/, `$1${urlOf('en')}$2`);

        const self = urlOf(lang);
        html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${self}$2`);
        html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${self}$2`);

        const alts = LANGS.map((l) =>
          `<link rel="alternate" hreflang="${l === 'zh' ? 'zh-Hans' : 'en'}" href="${urlOf(l)}">`
        ).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${urlOf('en')}">`;
        html = html.replace('</head>', alts + '\n</head>');

        // 语言切换按钮变成真链接，让爬虫能顺着爬到另一语言版本
        const other = lang === 'zh' ? 'en' : 'zh';
        html = html.replace(
          /<button class="ghost" id="langBtn"[^>]*>[\s\S]*?<\/button>/,
          `<a class="ghost" id="langBtn" href="${PATH[other]}" hreflang="${other === 'zh' ? 'zh-Hans' : 'en'}">${other === 'zh' ? '中文' : 'EN'}</a>`,  // PATH 已含 BASE
        );

        if (lang === 'en') bundle[entry].source = html;
        else this.emitFile({ type: 'asset', fileName: 'zh/index.html', source: html });
      }
    },
  };
}

function seoFiles() {
  return {
    name: 'flatpage-seo-files',
    apply: 'build',
    generateBundle() {
      const now = new Date().toISOString().slice(0, 10);
      const urls = LANGS.map((l) => `  <url>
    <loc>${urlOf(l)}</loc>
    <lastmod>${now}</lastmod>
${LANGS.map((a) => `    <xhtml:link rel="alternate" hreflang="${a === 'zh' ? 'zh-Hans' : 'en'}" href="${urlOf(a)}"/>`).join('\n')}
  </url>`).join('\n');
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
` });
      this.emitFile({ type: 'asset', fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}${BASE}sitemap.xml\n` });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [renderI18n(), seoFiles()],
  build: { assetsInlineLimit: 0 },
});
