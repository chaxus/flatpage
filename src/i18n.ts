/**
 * 双语文案：唯一数据源，编译期强制两边齐全。
 *
 * `Record<Locale, Messages>` 不是 Partial —— 少写一种语言的任何一个 key 都是
 * 编译错误。这比原先的运行时 validate() 早得多，也不需要那段检查代码。
 *
 * 运行时的翻译交给 ranuts/i18n（`t()` 的 key 同样是编译期检查的，
 * 拼错不会退化成「把 key 本身渲染出来」）。构建时 vite.config.ts 直接读
 * MESSAGES 做预渲染 —— 文案不能只在运行时注入，否则爬虫看到的是空 <h1>。
 */
import { createI18n, type I18nCore } from 'ranuts/i18n';

export const BRAND = 'FlatPage';

export const LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

/** 文案 key 的形状。加一条就要在下面两个字典里都补上，否则编译不过。 */
export interface Messages {
  'meta.title': string;
  'meta.desc': string;
  'hero.h1': string;
  'hero.sub': string;
  'hero.cta': string;
  'hero.paste': string;
  'paste.hint': string;
  'paste.denied': string;
  'paste.unsupported': string;
  'hero.drop': string;
  'privacy.badge': string;
  'privacy.title': string;
  'privacy.body': string;
  'step.detect': string;
  'step.loading': string;
  'step.processing': string;
  'step.done': string;
  'edit.title': string;
  'edit.hint': string;
  'edit.reset': string;
  'edit.full': string;
  'edit.notFound': string;
  'edit.paste': string;
  'opt.title': string;
  'opt.grid': string;
  'opt.gridHint': string;
  'opt.light': string;
  'opt.lightHint': string;
  'opt.colour': string;
  'opt.colourHint': string;
  'out.download': string;
  'out.downloadAll': string;
  'out.pdf': string;
  'out.progress': string;
  'out.savedAll': string;
  'out.applyAll': string;
  'layout.title': string;
  'layout.hint': string;
  'layout.none': string;
  'layout.a4-1': string;
  'layout.a4-2': string;
  'layout.a4-4': string;
  'layout.a4-land-1': string;
  'layout.free': string;
  'canvas.title': string;
  'canvas.hint': string;
  'canvas.rearrange': string;
  'canvas.fit': string;
  'canvas.front': string;
  'layout.sheets': string;
  'out.applied': string;
  'out.add': string;
  'out.remove': string;
  'out.clear': string;
  'out.pages': string;
  'err.detect': string;
  'err.noimage': string;
  'err.decode': string;
  'err.heic': string;
  'tips.title': string;
  'tips.1': string;
  'tips.2': string;
  'tips.3': string;
  'tips.4': string;
  'offline.ready': string;
  'foot.privacy': string;
  'foot.how': string;
  'foot.offline': string;
}

const en: Messages = {
  'meta.title': `${BRAND} — Flatten curved photos of documents, in your browser`,
  'meta.desc': 'Turn a photo of a curved book or booklet page into a flat, cropped, shadow-free scan. Fixes perspective, straightens warped lines, removes shadows. Files never leave your browser.',
  'hero.h1': 'Flatten curved photos of documents',
  'hero.sub': 'Photograph a booklet, a bound book, an ID page — get back a flat, cropped, shadow-free scan. Nothing is uploaded: the whole thing runs inside your browser, and works offline.',
  'hero.cta': 'Choose photos',
  'hero.paste': 'Paste',
  'paste.hint': 'or press ⌘V / Ctrl+V anywhere on this page',
  'paste.denied': 'The browser blocked clipboard access — press ⌘V / Ctrl+V instead.',
  'paste.unsupported': 'This browser cannot read the clipboard on click — press ⌘V / Ctrl+V instead.',
  'hero.drop': 'drop images here, or paste with ⌘V — JPG, PNG, HEIC',
  'privacy.badge': 'Runs entirely offline',
  'privacy.title': 'Your files never leave this device',
  'privacy.body': 'There is no upload button and no server to upload to. The image is decoded and processed by WebAssembly inside this tab. After the first visit the whole tool is cached, so you can turn off your Wi-Fi and it still works — that is the test.',
  'step.detect': 'Finding the page…',
  'step.loading': 'Loading engine…',
  'step.processing': 'Flattening…',
  'step.done': 'Done',
  'edit.title': 'Drag the corners',
  'edit.hint': 'We guessed the page edges. Drag any corner to correct it — the preview updates as you drag.',
  'edit.reset': 'Redetect',
  'edit.full': 'Whole image',
  'edit.notFound': 'Could not find the page automatically — drag the four corners onto it.',
  'edit.paste': 'You can also paste an image with ⌘V / Ctrl+V',
  'opt.title': 'Adjustments',
  'opt.grid': 'Straighten curved lines',
  'opt.gridHint': 'Uses ruled lines or table borders as a reference. Best on forms, tables and lined pages.',
  'opt.light': 'Remove shadows',
  'opt.lightHint': 'Evens out the lighting across the page without washing out colour.',
  'opt.colour': 'Keep colour',
  'opt.colourHint': 'Keeps red seals and coloured stamps intact. Turn off only if you need a grey scan.',
  'out.download': 'Download JPG',
  'out.downloadAll': 'All as JPG',
  'out.pdf': 'All as PDF',
  'out.progress': 'Processing',
  'out.savedAll': 'Saved {n} images',
  'out.applyAll': 'Apply settings to all pages',
  'layout.title': 'Print layout',
  'layout.hint': 'Fits the pages onto A4 at 300dpi, keeping proportions. For handing in printed copies.',
  'layout.none': 'No layout — original size',
  'layout.a4-1': 'A4 · one per page',
  'layout.a4-2': 'A4 · two per page',
  'layout.a4-4': 'A4 · four per page',
  'layout.a4-land-1': 'A4 landscape · one per page',
  'layout.free': 'Free — arrange by hand',
  'canvas.title': 'Arrange on the sheet',
  'canvas.hint': 'Drag to move, drag the bottom-right corner to resize. Pages are placed automatically first.',
  'canvas.rearrange': 'Auto arrange',
  'canvas.fit': 'Fit selected',
  'canvas.front': 'Bring to front',
  'layout.sheets': '{n} sheet(s)',
  'out.applied': 'Applied to {n} pages',
  'out.add': 'Add more pages',
  'out.remove': 'Remove',
  'out.clear': 'Clear all',
  'out.pages': 'pages',
  'err.detect': 'Could not find the page automatically. Drag the corners to mark it yourself.',
  'err.noimage': 'No image in the clipboard.',
  'err.decode': 'Could not read this file.',
  'err.heic': 'This HEIC could not be decoded. Try exporting it as JPG first.',
  'tips.title': 'Getting the best result',
  'tips.1': 'Shoot one page at a time. A two-page spread bends across the spine and cannot be flattened as a single surface.',
  'tips.2': 'Press the page flat with a sheet of glass or clear acrylic if you have one. This single trick beats any amount of software correction.',
  'tips.3': 'Shoot straight down, from a little further away with zoom. Wide-angle up close adds distortion that is harder to undo.',
  'tips.4': 'Light from both sides, and turn the flash off. A single overhead lamp casts a shadow into every crease.',
  'offline.ready': 'Cached — this tool now works offline',
  'foot.privacy': 'Privacy',
  'foot.how': 'How it works',
  'foot.offline': 'Works offline',
};

const zh: Messages = {
  'meta.title': `${BRAND} 拍平 — 把拍弯的证件和书页拉直，全程在你的浏览器里`,
  'meta.desc': '把弯曲的本子、证件、书页照片，变成裁切好、无阴影、不扭曲的扫描件。自动透视校正、拉直弯曲、去除阴影。图片全程不离开你的浏览器。',
  'hero.h1': '把拍弯的文档照片拉平',
  'hero.sub': '拍一本户口本、一页装订的书、一张证件 —— 得到裁切好、无阴影、不扭曲的扫描件。没有上传：全部运算在你的浏览器里完成，断网也能用。',
  'hero.cta': '选择照片',
  'hero.paste': '粘贴',
  'paste.hint': '或在页面任意位置按 ⌘V / Ctrl+V',
  'paste.denied': '浏览器拒绝了剪贴板访问 —— 直接按 ⌘V / Ctrl+V 即可。',
  'paste.unsupported': '此浏览器不支持点击读取剪贴板 —— 直接按 ⌘V / Ctrl+V 即可。',
  'hero.drop': '把图片拖进来，或按 ⌘V 粘贴 — JPG、PNG、HEIC',
  'privacy.badge': '完全离线运行',
  'privacy.title': '文件不会离开这台设备',
  'privacy.body': '这里没有「上传」按钮，也没有可上传的服务器。图片由这个标签页内的 WebAssembly 解码和处理。首次访问后整个工具会被缓存下来，所以你可以关掉 Wi-Fi 再用一次 —— 这就是验证方法。',
  'step.detect': '正在找页面边界…',
  'step.loading': '正在加载处理引擎…',
  'step.processing': '正在拉平…',
  'step.done': '完成',
  'edit.title': '拖动四个角',
  'edit.hint': '页面边界是自动识别的。拖动任意角点修正，右侧预览会跟着变。',
  'edit.reset': '重新识别',
  'edit.full': '整张图',
  'edit.notFound': '没能自动识别页面边界 —— 请把四个角拖到页面上。',
  'edit.paste': '也可以用 ⌘V / Ctrl+V 直接粘贴图片',
  'opt.title': '调整',
  'opt.grid': '拉直弯曲',
  'opt.gridHint': '以表格线或横格线为基准校正。表格、证件、有格线的页面效果最好。',
  'opt.light': '去除阴影',
  'opt.lightHint': '拉平整页光照，同时不冲淡颜色。',
  'opt.colour': '保留彩色',
  'opt.colourHint': '保留红色印章和盖章。只有确实需要灰度件时才关掉。',
  'out.download': '下载 JPG',
  'out.downloadAll': '全部下载 JPG',
  'out.pdf': '全部导出 PDF',
  'out.progress': '正在处理',
  'out.savedAll': '已保存 {n} 张',
  'out.applyAll': '设置应用到全部页',
  'layout.title': '打印版式',
  'layout.hint': '把页面排进 A4（300dpi），保持比例不变形。用于打印交材料。',
  'layout.none': '不拼版 — 保持原尺寸',
  'layout.a4-1': 'A4 · 一页一张',
  'layout.a4-2': 'A4 · 一页两张',
  'layout.a4-4': 'A4 · 一页四张',
  'layout.a4-land-1': 'A4 横向 · 一页一张',
  'layout.free': '自由排布 — 手动摆',
  'canvas.title': '在纸上排布',
  'canvas.hint': '拖动移动，拖右下角缩放。先自动铺好，再按需要挪。',
  'canvas.rearrange': '重新自动排',
  'canvas.fit': '选中项铺满',
  'canvas.front': '移到最上层',
  'layout.sheets': '{n} 张纸',
  'out.applied': '已应用到 {n} 页',
  'out.add': '添加更多页',
  'out.remove': '移除',
  'out.clear': '全部清除',
  'out.pages': '页',
  'err.detect': '没能自动找到页面边界。请手动拖动四个角标出来。',
  'err.noimage': '剪贴板里没有图片。',
  'err.decode': '读不出这个文件。',
  'err.heic': 'HEIC 解码失败。可以先导出成 JPG 再试。',
  'tips.title': '怎么拍效果最好',
  'tips.1': '一次只拍一页。跨页在中缝处是两个曲面，没法当一个平面拉直。',
  'tips.2': '有条件就用玻璃或亚克力板把页面压平。这一条比任何后期算法都管用。',
  'tips.3': '垂直俯拍，站远一点用变焦。凑太近用广角会引入更难消除的畸变。',
  'tips.4': '两侧打光，关掉闪光灯。头顶单一光源会在每道折痕里投出阴影。',
  'offline.ready': '已缓存 — 现在可以离线使用',
  'foot.privacy': '隐私',
  'foot.how': '原理',
  'foot.offline': '可离线使用',
};

export const MESSAGES: Record<Locale, Messages> = { en, zh };

export const isLocale = (v: string | null | undefined): v is Locale =>
  v === 'en' || v === 'zh';

/**
 * 初始语言以「预渲染页面的 lang 属性」为准：访客直接落在 /zh/ 时，
 * 不能被 JS 又切回英文。
 */
export function detectLocale(): Locale {
  const docLang = document.documentElement.lang.toLowerCase();
  if (docLang.startsWith('zh')) return 'zh';
  if (docLang.startsWith('en')) return 'en';
  const saved = localStorage.getItem('flatpage.lang');
  if (isLocale(saved)) return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function setupI18n(): I18nCore<Messages> {
  return createI18n<Messages>({
    locale: detectLocale(),
    fallbackLocale: 'en',
    messages: MESSAGES,
  });
}
