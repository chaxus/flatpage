/**
 * 双语文案唯一数据源。
 * 两种语言并排写在同一个 key 下 —— 分成两个文件必然漂移。
 * 缺任何一边，validate() 会在构建时报错。
 */
export const BRAND = 'FlatPage';

export const STRINGS = {
  'meta.title': {
    en: `${BRAND} — Flatten curved photos of documents, in your browser`,
    zh: `${BRAND} 拍平 — 把拍弯的证件和书页拉直，全程在你的浏览器里`,
  },
  'meta.desc': {
    en: 'Turn a photo of a curved book or booklet page into a flat, cropped, shadow-free scan. Fixes perspective, straightens warped lines, removes shadows. Files never leave your browser.',
    zh: '把弯曲的本子、证件、书页照片，变成裁切好、无阴影、不扭曲的扫描件。自动透视校正、拉直弯曲、去除阴影。图片全程不离开你的浏览器。',
  },

  'hero.h1': {
    en: 'Flatten curved photos of documents',
    zh: '把拍弯的文档照片拉平',
  },
  'hero.sub': {
    en: 'Photograph a booklet, a bound book, an ID page — get back a flat, cropped, shadow-free scan. Nothing is uploaded: the whole thing runs inside your browser, and works offline.',
    zh: '拍一本户口本、一页装订的书、一张证件 —— 得到裁切好、无阴影、不扭曲的扫描件。没有上传：全部运算在你的浏览器里完成，断网也能用。',
  },
  'hero.cta': { en: 'Choose photos', zh: '选择照片' },
  'hero.drop': {
    en: 'drop images here, or paste with ⌘V — JPG, PNG, HEIC',
    zh: '把图片拖进来，或按 ⌘V 粘贴 — JPG、PNG、HEIC',
  },

  'privacy.badge': { en: 'Runs entirely offline', zh: '完全离线运行' },
  'privacy.title': { en: 'Your files never leave this device', zh: '文件不会离开这台设备' },
  'privacy.body': {
    en: 'There is no upload button and no server to upload to. The image is decoded and processed by WebAssembly inside this tab. After the first visit the whole tool is cached, so you can turn off your Wi-Fi and it still works — that is the test.',
    zh: '这里没有「上传」按钮，也没有可上传的服务器。图片由这个标签页内的 WebAssembly 解码和处理。首次访问后整个工具会被缓存下来，所以你可以关掉 Wi-Fi 再用一次 —— 这就是验证方法。',
  },

  'step.detect': { en: 'Finding the page…', zh: '正在找页面边界…' },
  'step.loading': { en: 'Loading engine…', zh: '正在加载处理引擎…' },
  'step.processing': { en: 'Flattening…', zh: '正在拉平…' },
  'step.done': { en: 'Done', zh: '完成' },

  'edit.title': { en: 'Drag the corners', zh: '拖动四个角' },
  'edit.hint': {
    en: 'We guessed the page edges. Drag any corner to correct it — the preview updates as you drag.',
    zh: '页面边界是自动识别的。拖动任意角点修正，右侧预览会跟着变。',
  },
  'edit.reset': { en: 'Redetect', zh: '重新识别' },
  'edit.full': { en: 'Whole image', zh: '整张图' },
  'edit.notFound': {
    en: 'Could not find the page automatically — drag the four corners onto it.',
    zh: '没能自动识别页面边界 —— 请把四个角拖到页面上。',
  },
  'edit.paste': { en: 'You can also paste an image with ⌘V / Ctrl+V', zh: '也可以用 ⌘V / Ctrl+V 直接粘贴图片' },

  'opt.title': { en: 'Adjustments', zh: '调整' },
  'opt.grid': { en: 'Straighten curved lines', zh: '拉直弯曲' },
  'opt.gridHint': {
    en: 'Uses ruled lines or table borders as a reference. Best on forms, tables and lined pages.',
    zh: '以表格线或横格线为基准校正。表格、证件、有格线的页面效果最好。',
  },
  'opt.light': { en: 'Remove shadows', zh: '去除阴影' },
  'opt.lightHint': {
    en: 'Evens out the lighting across the page without washing out colour.',
    zh: '拉平整页光照，同时不冲淡颜色。',
  },
  'opt.colour': { en: 'Keep colour', zh: '保留彩色' },
  'opt.colourHint': {
    en: 'Keeps red seals and coloured stamps intact. Turn off only if you need a grey scan.',
    zh: '保留红色印章和盖章。只有确实需要灰度件时才关掉。',
  },

  'out.download': { en: 'Download JPG', zh: '下载 JPG' },
  'out.downloadAll': { en: 'All as JPG', zh: '全部下载 JPG' },
  'out.pdf': { en: 'All as PDF', zh: '全部导出 PDF' },
  'out.progress': { en: 'Processing', zh: '正在处理' },
  'out.savedAll': { en: 'Saved {n} images', zh: '已保存 {n} 张' },
  'out.applyAll': { en: 'Apply settings to all pages', zh: '设置应用到全部页' },
  'out.applied': { en: 'Applied to {n} pages', zh: '已应用到 {n} 页' },
  'out.add': { en: 'Add more pages', zh: '添加更多页' },
  'out.remove': { en: 'Remove', zh: '移除' },
  'out.clear': { en: 'Clear all', zh: '全部清除' },
  'out.pages': { en: 'pages', zh: '页' },

  'err.detect': {
    en: 'Could not find the page automatically. Drag the corners to mark it yourself.',
    zh: '没能自动找到页面边界。请手动拖动四个角标出来。',
  },
  'err.noimage': { en: 'No image in the clipboard.', zh: '剪贴板里没有图片。' },
  'err.decode': { en: 'Could not read this file.', zh: '读不出这个文件。' },
  'err.heic': {
    en: 'This HEIC could not be decoded. Try exporting it as JPG first.',
    zh: 'HEIC 解码失败。可以先导出成 JPG 再试。',
  },

  'tips.title': { en: 'Getting the best result', zh: '怎么拍效果最好' },
  'tips.1': {
    en: 'Shoot one page at a time. A two-page spread bends across the spine and cannot be flattened as a single surface.',
    zh: '一次只拍一页。跨页在中缝处是两个曲面，没法当一个平面拉直。',
  },
  'tips.2': {
    en: 'Press the page flat with a sheet of glass or clear acrylic if you have one. This single trick beats any amount of software correction.',
    zh: '有条件就用玻璃或亚克力板把页面压平。这一条比任何后期算法都管用。',
  },
  'tips.3': {
    en: 'Shoot straight down, from a little further away with zoom. Wide-angle up close adds distortion that is harder to undo.',
    zh: '垂直俯拍，站远一点用变焦。凑太近用广角会引入更难消除的畸变。',
  },
  'tips.4': {
    en: 'Light from both sides, and turn the flash off. A single overhead lamp casts a shadow into every crease.',
    zh: '两侧打光，关掉闪光灯。头顶单一光源会在每道折痕里投出阴影。',
  },

  'offline.ready': {
    en: 'Cached — this tool now works offline',
    zh: '已缓存 — 现在可以离线使用',
  },

  'foot.privacy': { en: 'Privacy', zh: '隐私' },
  'foot.how': { en: 'How it works', zh: '原理' },
  'foot.offline': { en: 'Works offline', zh: '可离线使用' },
};

/** 构建期护栏：任何 key 缺一边语言就报错，防止双语漂移 */
export function validate() {
  const bad = [];
  for (const [k, v] of Object.entries(STRINGS)) {
    if (!v || typeof v.en !== 'string' || !v.en.trim()) bad.push(`${k}.en`);
    if (!v || typeof v.zh !== 'string' || !v.zh.trim()) bad.push(`${k}.zh`);
  }
  if (bad.length) throw new Error('i18n 缺失: ' + bad.join(', '));
  return Object.keys(STRINGS).length;
}

export const LANGS = ['en', 'zh'];

export function detectLang() {
  const saved = localStorage.getItem('flatpage.lang');
  if (saved && LANGS.includes(saved)) return saved;
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function makeT(lang) {
  return (key) => {
    const e = STRINGS[key];
    if (!e) throw new Error('未知文案 key: ' + key);
    return e[lang] ?? e.en;
  };
}
