/**
 * FlatPage — 主界面逻辑。
 * 所有 OpenCV 运算在 worker 里；这里只负责画面、拖拽和导出。
 */
import { makeT, detectLang, validate, STRINGS } from './i18n.js';
import { LAYOUTS, layoutById, layoutIcon, compose } from './layout.js';

validate(); // 双语缺失就直接炸，别等上线才发现

const $ = (id) => document.getElementById(id);
let worker = null;
/** 首屏不建 worker：建了就会去下 OpenCV 的 wasm。等用户真的选了图再说。 */
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  return worker;
}

// 预渲染页面的 lang 属性优先：否则访客直接落在 /zh/ 会被 JS 切回英文
let lang = (document.documentElement.lang || '').toLowerCase().startsWith('zh')
  ? 'zh' : (document.documentElement.dataset.forceLang || detectLang());
let t = makeT(lang);
const docs = [];        // { id, name, bitmap, width, height, quad, quad0, out, thumbUrl }
let active = -1;
let reqSeq = 0;
const pending = new Map();

/* ---------------- offline ---------------- */
// 首页写着「关掉 Wi-Fi 它照样能用」。没有这段注册，那句话是假的。
// dev 模式没有 sw.js，跳过。
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || '/';
    // 页面承诺了「关掉 Wi-Fi 也能用」，那就该让它变成可见的事实。
    // controller 为空 = 本次是首访，SW 还没接管；它接管时说明缓存已就绪。
    const firstVisit = !navigator.serviceWorker.controller;
    navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch((e) => {
      console.warn('离线支持不可用:', e.message);   // 注册失败不影响正常使用
    });
    if (firstVisit) {
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => toast(t('offline.ready')),
        { once: true },
      );
    }
  });
}

/* ---------------- i18n / theme ---------------- */
function applyLang() {
  t = makeT(lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]').content = t('meta.desc');
  if ($('langBtn').tagName !== 'A') $('langBtn').textContent = lang === 'zh' ? 'EN' : '中文';
  if (active >= 0) { setStatus('step.done'); updateDetectHint(); }
  renderLayoutOpts();
  updateSheetCount();
}
$('langBtn').onclick = (e) => {
  // 生产构建把它换成了带 href 的 <a>，让爬虫能顺着爬到另一语言版本
  if ($('langBtn').tagName === 'A') return;
  e.preventDefault();
  lang = lang === 'zh' ? 'en' : 'zh';
  localStorage.setItem('flatpage.lang', lang);
  applyLang();
};
$('themeBtn').onclick = () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
  if (next) document.documentElement.dataset.theme = next;
  else delete document.documentElement.dataset.theme;
  localStorage.setItem('flatpage.theme', next);
};
const savedTheme = localStorage.getItem('flatpage.theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
applyLang();

/* ---------------- toast ---------------- */
let toastTimer;
function toast(msg) {
  console.debug('[flatpage] toast:', msg);   // toast 只显示 3.6s，留一条给排查用
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3600);
}
function setStatus(key) { $('statusText').textContent = t(key); }
function busy(on, text) {
  $('busy').hidden = !on;
  if (on) $('busy').textContent = text || t('step.processing');
}
const fmt = (key, vals) =>
  Object.entries(vals).reduce((s2, [k, v]) => s2.replaceAll(`{${k}}`, v), t(key));

/* ---------------- worker bridge ---------------- */
function onWorkerMessage(e) {
  const { type, reqId } = e.data;
  if (type === 'status') {
    if (e.data.stage === 'loading') { busy(true); $('busy').textContent = t('step.loading'); }
    return;
  }
  const p = pending.get(reqId);
  if (!p) return;
  pending.delete(reqId);
  if (type === 'error') p.reject(new Error(e.data.message));
  else p.resolve(e.data);
}
function call(msg, transfer) {
  const reqId = ++reqSeq;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    getWorker().postMessage({ ...msg, reqId }, transfer || []);
  });
}

/* ---------------- file intake ---------------- */
$('pickBtn').onclick = () => $('file').click();
$('addBtn').onclick = () => $('file').click();
$('file').onchange = (e) => { intake([...e.target.files]); e.target.value = ''; };

const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
}
for (const ev of ['dragleave', 'drop']) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
}
drop.addEventListener('drop', (e) => intake([...e.dataTransfer.files]));

/**
 * 主动读剪贴板。⌘V 全局监听一直都在，但有图之后 hero 折叠、那句提示就看不见了，
 * 用户没办法知道还能粘贴 —— 所以两个地方都放一个明确的按钮。
 */
async function pasteFromClipboard() {
  if (!navigator.clipboard?.read) { toast(t('paste.unsupported')); return; }
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      const type = item.types.find((ty) => ty.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      files.push(new File([blob], `pasted-${Date.now()}.${ext}`, { type }));
    }
    if (files.length) intake(files);
    else toast(t('err.noimage'));
  } catch (err) {
    // 权限被拒 / 不在安全上下文 / 无用户手势
    toast(t('paste.denied'));
  }
}
$('pasteBtn').onclick = pasteFromClipboard;
$('pasteBtn2').onclick = pasteFromClipboard;

// 键盘粘贴：截图工具、微信、预览里复制的图都能直接进来，省掉存盘再选文件
window.addEventListener('paste', (e) => {
  const items = [...(e.clipboardData?.items || [])];
  const files = items
    .filter((i) => i.kind === 'file')
    .map((i) => i.getAsFile())
    .filter((f) => f && (/^image\//.test(f.type) || /\.(jpe?g|png|hei[cf]|webp|tiff?)$/i.test(f.name)));
  if (files.length) {
    e.preventDefault();
    intake(files);
  } else if (e.clipboardData?.types?.includes('Files')) {
    toast(t('err.noimage'));
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

async function intake(files) {
  const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(hei[cf])$/i.test(f.name));
  if (!imgs.length) return;
  for (const f of imgs) {
    try {
      // createImageBitmap 会应用 EXIF 方向；不加这个参数 iPhone 的竖拍图会躺着
      const bitmap = await createImageBitmap(f, { imageOrientation: 'from-image' });
      const id = 'd' + Date.now() + Math.random().toString(36).slice(2, 7);
      const doc = { id, name: f.name.replace(/\.[^.]+$/, ''), width: bitmap.width,
                    height: bitmap.height, quad: null, out: null, opts: defaultOpts() };
      docs.push(doc);
      const idx = docs.length - 1;
      // bitmap 要在 worker 和主线程都用，克隆一份再转移
      const forWorker = await createImageBitmap(bitmap);
      doc.bitmap = bitmap;
      const r = await call({ type: 'load', id, bitmap: forWorker }, [forWorker]);
      // 检测框占满画面 = 大概率框到了整张图或跨页本子的外轮廓，不是想要的那一页。
      // 这种结果不能当成功用，否则用户看到的就是「框住了整张图」还不知道为什么。
      const trustworthy = r.autoDetected && (r.coverage ?? 1) <= 0.82;
      doc.quad = trustworthy ? r.quad : defaultQuad(doc.width, doc.height);
      doc.quad0 = doc.quad.map((p) => ({ ...p }));
      doc.autoDetected = trustworthy;
      doc.coverage = r.coverage ?? 0;
      renderStrip();
      if (active < 0) select(idx); else renderStrip();
    } catch (err) {
      toast(/hei[cf]/i.test(f.name) ? t('err.heic') : t('err.decode'));
      console.error(err);
    }
  }
  document.body.classList.toggle('has-docs', docs.length > 0);
  $('work').hidden = docs.length === 0;
  updateDetectHint();
  if (docs.length) $('work').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const defaultQuad = (w, h) => ([
  { x: w * 0.06, y: h * 0.06 }, { x: w * 0.94, y: h * 0.06 },
  { x: w * 0.94, y: h * 0.94 }, { x: w * 0.06, y: h * 0.94 },
]);

/* ---------------- page strip ---------------- */
function renderStrip() {
  const strip = $('strip');
  strip.innerHTML = '';
  docs.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'thumb' + (i === active ? ' on' : '');
    b.type = 'button';
    const c = document.createElement('canvas');
    const s = 92 / d.width;
    c.width = 92; c.height = Math.max(1, Math.round(d.height * s));
    c.getContext('2d').drawImage(d.bitmap, 0, 0, c.width, c.height);
    b.appendChild(c);
    const n = document.createElement('div');
    n.className = 'n'; n.textContent = i + 1;
    b.appendChild(n);
    const x = document.createElement('button');
    x.className = 'x'; x.type = 'button'; x.textContent = '×';
    x.title = t('out.remove');
    x.onclick = (e) => { e.stopPropagation(); remove(i); };
    b.appendChild(x);
    b.onclick = () => select(i);
    strip.appendChild(b);
  });
  strip.hidden = docs.length < 2;
  const many = docs.length > 1;
  $('dlAllBtn').hidden = !many;
  $('applyAllBtn').hidden = !many;
  updateSheetCount();
}

function remove(i) {
  const d = docs[i];
  call({ type: 'free', id: d.id }).catch(() => {});
  d.bitmap.close?.();
  docs.splice(i, 1);
  if (docs.length === 0) {
    active = -1; $('work').hidden = true;
    document.body.classList.remove('has-docs');
    renderStrip(); return;
  }
  active = Math.min(active, docs.length - 1);
  select(active);
}
$('clearBtn').onclick = () => { while (docs.length) remove(0); };

function select(i) {
  active = i;
  if (docs[i]?.opts) writeOptsUI(docs[i].opts);
  renderStrip();
  drawSource();
  updateDetectHint();
  schedulePreview(true);
}

/** 自动识别不可信时，把提示常驻在编辑区，而不是让 toast 一闪而过 */
function updateDetectHint() {
  const d = docs[active];
  const el = $('detectHint');
  if (!el) return;
  const failed = d && !d.autoDetected;
  el.hidden = !failed;
  if (failed) el.textContent = t('edit.notFound');
  $('stage')?.classList.toggle('needs-corners', !!failed);
}

/* ---------------- source canvas + corner handles ---------------- */
const stage = $('stage'), srcCanvas = $('srcCanvas'), overlay = $('overlay');

function drawSource() {
  const d = docs[active];
  if (!d) return;
  const maxw = 900;
  const s = Math.min(1, maxw / d.width);
  srcCanvas.width = Math.round(d.width * s);
  srcCanvas.height = Math.round(d.height * s);
  srcCanvas.getContext('2d').drawImage(d.bitmap, 0, 0, srcCanvas.width, srcCanvas.height);
  overlay.setAttribute('viewBox', `0 0 ${d.width} ${d.height}`);
  drawHandles();
}

function drawHandles() {
  const d = docs[active];
  if (!d) return;
  // 把屏幕 px 换算成 viewBox 单位，靠的是覆盖层的实际显示宽度。
  //
  // 两个试过但不行的写法：
  //   getBoundingClientRect().width || srcCanvas.width
  //     布局没完成时前者是 0，于是 fallback 到 canvas 的位图宽度(900)，
  //     把手在窄屏被算小 2.5 倍。桌面端两个值接近，正好把 bug 藏住。
  //   getScreenCTM().a
  //     这里返回单位矩阵，不反映 viewBox 缩放，把手更小(1px)。
  // 所以：拿真实显示宽度，拿不到就等下一帧再画。
  const shown = overlay.getBoundingClientRect().width
             || srcCanvas.getBoundingClientRect().width;
  if (!shown) { requestAnimationFrame(drawHandles); return; }
  const px = (n) => (n / shown) * d.width;
  const r = px(9);        // 看得见的圆点
  const hit = px(23);     // 命中区 46px 直径 —— 手指按不准 18px 的点
  const pts = d.quad.map((p) => `${p.x},${p.y}`).join(' ');
  overlay.innerHTML =
    `<polygon class="edge" points="${pts}"/>` +
    d.quad.map((p, i) =>
      `<circle class="handle" cx="${p.x}" cy="${p.y}" r="${r}"/>`).join('') +
    // 命中区画在最上层，透明；视觉尺寸不变，可点区域大一倍多
    d.quad.map((p, i) =>
      `<circle class="grab" data-i="${i}" cx="${p.x}" cy="${p.y}" r="${hit}"/>`).join('');
}

/* ---- 拖动时的放大镜 ---- */
const magnifier = $('magnifier');
const MAG_ZOOM = 2.6;

/** 把被手指盖住的那个角显示到别处 */
function showMagnifier(imgX, imgY) {
  const d = docs[active];
  if (!d) return;
  const rect = srcCanvas.getBoundingClientRect();
  if (!rect.width) return;
  const size = magnifier.width;                 // 位图边长
  const srcSize = size / MAG_ZOOM;              // 从原图取多大一块
  const ctx = magnifier.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(
    d.bitmap,
    imgX - srcSize / 2, imgY - srcSize / 2, srcSize, srcSize,
    0, 0, size, size,
  );
  // 十字准星，标出角点落在哪
  ctx.strokeStyle = 'rgba(255,0,0,.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(size / 2, size / 2 - 12); ctx.lineTo(size / 2, size / 2 + 12);
  ctx.moveTo(size / 2 - 12, size / 2); ctx.lineTo(size / 2 + 12, size / 2);
  ctx.stroke();

  // 定位：默认在角点上方，靠近顶部时翻到下方，避免贴边看不见
  const dispX = (imgX / d.width) * rect.width;
  const dispY = (imgY / d.height) * rect.height;
  const box = 88;
  const above = dispY > box + 16;
  magnifier.style.left = `${Math.max(0, Math.min(rect.width - box, dispX - box / 2))}px`;
  magnifier.style.top = `${above ? dispY - box - 14 : dispY + 14}px`;
  magnifier.hidden = false;
}

const hideMagnifier = () => { magnifier.hidden = true; };

let dragIdx = -1;
function toImg(evt) {
  const d = docs[active];
  const rect = srcCanvas.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) / rect.width) * d.width,
    y: ((evt.clientY - rect.top) / rect.height) * d.height,
  };
}
stage.addEventListener('pointerdown', (e) => {
  const h = e.target.closest?.('.grab');
  if (!h) return;
  dragIdx = +h.dataset.i;
  stage.setPointerCapture(e.pointerId);
  const p0 = docs[active].quad[dragIdx];
  showMagnifier(p0.x, p0.y);
  e.preventDefault();   // 阻止触屏上的滚动/长按选择
});
stage.addEventListener('pointermove', (e) => {
  if (dragIdx < 0) return;
  const d = docs[active];
  const p = toImg(e);
  d.quad[dragIdx] = {
    x: Math.max(0, Math.min(d.width, p.x)),
    y: Math.max(0, Math.min(d.height, p.y)),
  };
  drawHandles();
  showMagnifier(d.quad[dragIdx].x, d.quad[dragIdx].y);
  schedulePreview();
});
stage.addEventListener('pointerup', (e) => {
  if (dragIdx < 0) return;
  dragIdx = -1;
  stage.releasePointerCapture?.(e.pointerId);
  hideMagnifier();
  drawHandles();
  schedulePreview(true);
});
stage.addEventListener('pointercancel', () => { dragIdx = -1; hideMagnifier(); });

// 横竖屏切换 / 窗口缩放后，px 与 viewBox 的比例变了，把手要重算
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (docs[active]) drawHandles(); }, 120);
});

$('resetBtn').onclick = async () => {
  const d = docs[active]; if (!d) return;
  // 重新跑一次检测。以前这里是「恢复到 quad0」—— 而 quad0 可能本身就是失败结果，
  // 于是点了没反应，看起来像坏了。
  busy(true);
  try {
    const bmp = await createImageBitmap(d.bitmap);
    const r = await call({ type: 'load', id: d.id, bitmap: bmp }, [bmp]);
    const trustworthy = r.autoDetected && (r.coverage ?? 1) <= 0.82;
    d.quad = trustworthy ? r.quad : defaultQuad(d.width, d.height);
    d.quad0 = d.quad.map((p) => ({ ...p }));
    d.autoDetected = trustworthy;
    if (!trustworthy) toast(t('err.detect'));
    updateDetectHint();
    drawHandles();
    schedulePreview(true);
  } catch (e) {
    toast(e.message);
  } finally {
    busy(false);
  }
};
$('fullBtn').onclick = () => {
  const d = docs[active]; if (!d) return;
  d.quad = [{ x: 0, y: 0 }, { x: d.width, y: 0 },
            { x: d.width, y: d.height }, { x: 0, y: d.height }];
  drawHandles(); schedulePreview(true);
};

/* ---------------- preview ---------------- */
/** 每页各自持有设置；UI 开关是「当前页」的视图。
 *  以前 opts() 直接读 UI，于是「应用到全部」写进 d.opts 的值根本没人读。 */
const defaultOpts = () => ({ grid: true, light: 1.0, colour: true });
const readOptsUI = () => ({
  grid: $('optGrid').checked,
  light: $('optLight').checked ? 1.0 : 0,
  colour: $('optColour').checked,
});
function writeOptsUI(o) {
  $('optGrid').checked = !!o.grid;
  $('optLight').checked = o.light > 0;
  $('optColour').checked = !!o.colour;
}
const opts = () => docs[active]?.opts || defaultOpts();

for (const id of ['optGrid', 'optLight', 'optColour']) {
  $(id).onchange = () => {
    if (docs[active]) docs[active].opts = readOptsUI();
    schedulePreview(true);
  };
}

let previewTimer, previewToken = 0;
function schedulePreview(immediate) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, immediate ? 0 : 90);
}
async function runPreview() {
  const d = docs[active];
  if (!d) return;
  const token = ++previewToken;
  busy(true);
  try {
    const r = await call({ type: 'preview', id: d.id, quad: d.quad, opts: d.opts || defaultOpts() });
    if (token !== previewToken) return;   // 拖拽中的旧结果直接丢掉
    paint($('outCanvas'), r.image);
    $('metaText').textContent =
      `${r.image.width}×${r.image.height}` +
      (r.lines ? `  ·  ${r.lines} ${lang === 'zh' ? '条线' : 'lines'}` : '');
    setStatus('step.done');
  } catch (err) {
    toast(err.message);
  } finally {
    if (token === previewToken) busy(false);
  }
}
function paint(canvas, imageData) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
}

/* ---------------- print layout ---------------- */
let layoutId = localStorage.getItem('flatpage.layout') || 'none';

function renderLayoutOpts() {
  const box = $('layoutOpts');
  box.innerHTML = '';
  for (const l of LAYOUTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'layout-opt' + (l.id === layoutId ? ' on' : '');
    b.innerHTML = layoutIcon(l) + `<span>${t('layout.' + l.id)}</span>`;
    b.onclick = () => {
      layoutId = l.id;
      localStorage.setItem('flatpage.layout', layoutId);
      renderLayoutOpts();
      updateSheetCount();
    };
    box.appendChild(b);
  }
}

/** 让用户先知道会印出几张纸，再点导出 */
function updateSheetCount() {
  const l = layoutById(layoutId);
  const perPage = l.page ? l.cols * l.rows : 1;
  const sheets = Math.max(1, Math.ceil(docs.length / perPage));
  $('sheetCount').textContent = docs.length ? fmt('layout.sheets', { n: sheets }) : '';
}

/* ---------------- export ---------------- */
/** 处理所有页并按当前版式排好，返回待导出的画布数组 */
async function renderAllComposed() {
  const out = [];
  for (let i = 0; i < docs.length; i++) {
    busy(true, `${t('out.progress')} ${i + 1}/${docs.length}`);
    out.push(await renderFull(docs[i]));
  }
  return compose(out, layoutId);
}

async function renderFull(d) {
  const r = await call({ type: 'export', id: d.id, quad: d.quad, opts: d.opts || defaultOpts() });
  const c = document.createElement('canvas');
  paint(c, r.image);
  return c;
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('dlBtn').onclick = async () => {
  const d = docs[active]; if (!d) return;
  busy(true);
  try {
    const c = await renderFull(d);
    // 选了版式就按版式出这一张，跟「全部下载」的行为保持一致
    const sheet = compose([c], layoutId)[0];
    const blob = await new Promise((res) => sheet.toBlob(res, 'image/jpeg', 0.95));
    saveBlob(blob, `${d.name}_flat.jpg`);
  } catch (e) { toast(e.message); } finally { busy(false); }
};

// 逐张全分辨率处理并保存。浏览器对连续下载有节流，给每次之间留点间隔。
$('dlAllBtn').onclick = async () => {
  if (!docs.length) return;
  busy(true);
  try {
    const sheets = await renderAllComposed();
    const composed = layoutById(layoutId).page;
    for (let i = 0; i < sheets.length; i++) {
      const blob = await new Promise((res) => sheets[i].toBlob(res, 'image/jpeg', 0.95));
      const name = composed ? `flatpage_${layoutId}_${i + 1}` : `${docs[i].name}_flat`;
      saveBlob(blob, `${name}.jpg`);
      if (i < sheets.length - 1) await new Promise((r) => setTimeout(r, 350));
    }
    toast(fmt('out.savedAll', { n: sheets.length }));
  } catch (e) { toast(e.message); } finally { busy(false); }
};

// 当前页的三个开关套用到所有页 —— 同一本证件逐页调一遍很烦
$('applyAllBtn').onclick = () => {
  if (docs.length < 2) return;
  const o = readOptsUI();
  for (const d of docs) d.opts = { ...o };
  toast(fmt('out.applied', { n: docs.length }));
};

$('pdfBtn').onclick = async () => {
  if (!docs.length) return;
  busy(true);
  try {
    const { buildPdf, canvasToJpegBytes } = await import('./pdf.js');
    const sheets = await renderAllComposed();
    const pages = [];
    for (const c of sheets) {
      pages.push({ jpeg: await canvasToJpegBytes(c), width: c.width, height: c.height });
    }
    saveBlob(buildPdf(pages), 'flatpage.pdf');
  } catch (e) { toast(e.message); console.error(e); } finally { busy(false); }
};
