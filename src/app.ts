/**
 * FlatPage — 主界面逻辑。
 * 所有 OpenCV 运算在 worker 里；这里只负责画面、拖拽和导出。
 */
import 'ranui/button';
import 'ranui/checkbox';
import 'ranui/theme-switch';
import { initTheme } from 'ranui/theme';
import { debounce } from 'ranuts/utils';

import { setupI18n, isLocale, type Locale, type Messages } from './i18n';
import {
  LAYOUTS, layoutById, layoutIcon, compose, autoArrange, composeFree, A4,
  type Box, type Layout,
} from './layout';
import type { Point } from './pipeline';
import type { ProcessOpts } from './worker';

/** 一页待处理的图 */
interface Doc {
  id: string;
  name: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  quad: Point[];
  quad0: Point[];
  opts: ProcessOpts;
  autoDetected: boolean;
  coverage: number;
  preview?: HTMLCanvasElement;
}

interface FreeItem {
  docId: string;
  box: Box;
}

interface WorkerReply {
  type: string;
  reqId: number;
  id?: string;
  message?: string;
  image?: ImageData;
  quad?: Point[] | null;
  autoDetected?: boolean;
  coverage?: number;
  lines?: number;
  maxWarp?: number;
  stage?: string;
}

// 字典完整性由 Record<Locale, Messages> 在编译期保证，不再需要运行时 validate
const i18n = setupI18n();
const t = (key: keyof Messages, params?: Record<string, string | number>): string =>
  i18n.t(key, params);

initTheme();   // ranui：跟随系统 + 记住选择，替代原先手写的一套主题变量

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
let worker: Worker | null = null;
/** 首屏不建 worker：建了就会去下 OpenCV 的 wasm。等用户真的选了图再说。 */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  return worker;
}

// 预渲染页面的 lang 属性优先：否则访客直接落在 /zh/ 会被 JS 切回英文
const docs: Doc[] = [];
let active = -1;
let reqSeq = 0;
const pending = new Map<number, { resolve: (v: WorkerReply) => void; reject: (e: Error) => void }>();

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
function applyLang(): void {
  const lang = i18n.locale as Locale;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset['i18n'];
    if (key) el.textContent = t(key as keyof Messages);
  }
  document.title = t('meta.title');
  const desc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (desc) desc.content = t('meta.desc');
  const langBtn = $('langBtn');
  if (langBtn.tagName !== 'A') langBtn.textContent = lang === 'zh' ? 'EN' : '中文';
  if (active >= 0) { setStatus('step.done'); updateDetectHint(); }
  // 版式按钮 / 画布的刷新不放这里：applyLang 在模块顶部就会执行一次，那时
  // 画布那一段的 const（isFree、sheet）还在 TDZ，压缩后表现为「不是函数」。
  refreshChrome?.();
  if (isFree()) { ensureFreeItems(); renderSheet(); }
}
$('langBtn').onclick = (e: MouseEvent): void => {
  // 生产构建把它换成了带 href 的 <a>，让爬虫能顺着爬到另一语言版本
  if ($('langBtn').tagName === 'A') return;
  e.preventDefault();
  const next: Locale = i18n.locale === 'zh' ? 'en' : 'zh';
  localStorage.setItem('flatpage.lang', next);
  i18n.setLocale(next);
};
i18n.onChange(() => applyLang());
applyLang();

/* ---------------- toast ---------------- */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string): void {
  console.debug('[flatpage] toast:', msg);   // toast 只显示 3.6s，留一条给排查用
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3600);
}
function setStatus(key: keyof Messages): void { $('statusText').textContent = t(key); }
function busy(on: boolean, text?: string): void {
  $('busy').hidden = !on;
  if (on) $('busy').textContent = text || t('step.processing');
}
// 插值交给 ranuts/i18n（`{n}` 占位），不再手写 replaceAll
const fmt = (key: keyof Messages, vals: Record<string, string | number>): string =>
  t(key, vals);

/* ---------------- worker bridge ---------------- */
function onWorkerMessage(e: MessageEvent<WorkerReply>): void {
  const { type, reqId } = e.data;
  if (type === 'status') {
    if (e.data.stage === 'loading') { busy(true, t('step.loading')); }
    return;
  }
  const p = pending.get(reqId);
  if (!p) return;
  pending.delete(reqId);
  if (type === 'error') p.reject(new Error(e.data.message ?? 'worker error'));
  else p.resolve(e.data);
}
function call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<WorkerReply> {
  const reqId = ++reqSeq;
  return new Promise<WorkerReply>((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    getWorker().postMessage({ ...msg, reqId }, transfer);
  });
}

/* ---------------- file intake ---------------- */
$('pickBtn').onclick = () => $('file').click();
$('addBtn').onclick = () => $('file').click();
$<HTMLInputElement>('file').onchange = (e: Event): void => {
  const inp = e.target as HTMLInputElement;
  intake([...(inp.files ?? [])]);
  inp.value = '';
};

const drop = $('drop');
for (const ev of ['dragenter', 'dragover'] as const) {
  drop.addEventListener(ev, (e: Event) => { e.preventDefault(); drop.classList.add('over'); });
}
for (const ev of ['dragleave', 'drop'] as const) {
  drop.addEventListener(ev, (e: Event) => { e.preventDefault(); drop.classList.remove('over'); });
}
drop.addEventListener('drop', (e: DragEvent) => intake([...(e.dataTransfer?.files ?? [])]));

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
    .filter((f): f is File =>
      !!f && (/^image\//.test(f.type) || /\.(jpe?g|png|hei[cf]|webp|tiff?)$/i.test(f.name)));
  if (files.length) {
    e.preventDefault();
    intake(files);
  } else if (e.clipboardData?.types?.includes('Files')) {
    toast(t('err.noimage'));
  }
});
window.addEventListener('dragover', (e: Event) => e.preventDefault());
window.addEventListener('drop', (e: Event) => e.preventDefault());

async function intake(files: readonly File[]): Promise<void> {
  const imgs = files.filter((f: File) => /^image\//.test(f.type) || /\.(hei[cf])$/i.test(f.name));
  if (!imgs.length) return;
  for (const f of imgs) {
    try {
      // createImageBitmap 会应用 EXIF 方向；不加这个参数 iPhone 的竖拍图会躺着
      const bitmap = await createImageBitmap(f, { imageOrientation: 'from-image' });
      const id = 'd' + Date.now() + Math.random().toString(36).slice(2, 7);
      const doc: Doc = {
        id,
        name: f.name.replace(/\.[^.]+$/, ''),
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        quad: [],
        quad0: [],
        opts: defaultOpts(),
        autoDetected: false,
        coverage: 0,
      };
      docs.push(doc);
      const idx = docs.length - 1;
      // bitmap 要在 worker 和主线程都用，克隆一份再转移
      const forWorker = await createImageBitmap(bitmap);
      const r = await call({ type: 'load', id, bitmap: forWorker }, [forWorker]);
      // 检测框占满画面 = 大概率框到了整张图或跨页本子的外轮廓，不是想要的那一页。
      // 这种结果不能当成功用，否则用户看到的就是「框住了整张图」还不知道为什么。
      const trustworthy = !!r.autoDetected && (r.coverage ?? 1) <= 0.82 && !!r.quad;
      doc.quad = trustworthy ? r.quad! : defaultQuad(doc.width, doc.height);
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

const defaultQuad = (w: number, h: number): Point[] => ([
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
    c.getContext('2d')!.drawImage(d.bitmap, 0, 0, c.width, c.height);
    b.appendChild(c);
    const n = document.createElement('div');
    n.className = 'n'; n.textContent = String(i + 1);
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

function remove(i: number): void {
  const d = docs[i];
  if (!d) return;
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

function select(i: number): void {
  active = i;
  const sel = docs[i];
  if (sel?.opts) writeOptsUI(sel.opts);
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
const stage = $('stage');
const srcCanvas = $<HTMLCanvasElement>('srcCanvas');
const overlay = document.getElementById('overlay') as unknown as SVGSVGElement;

function drawSource(): void {
  const d = docs[active];
  if (!d) return;
  const maxw = 900;
  const s = Math.min(1, maxw / d.width);
  srcCanvas.width = Math.round(d.width * s);
  srcCanvas.height = Math.round(d.height * s);
  srcCanvas.getContext('2d')!.drawImage(d.bitmap, 0, 0, srcCanvas.width, srcCanvas.height);
  overlay.setAttribute('viewBox', `0 0 ${d.width} ${d.height}`);
  drawHandles();
}

function drawHandles(): void {
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
  const px = (n: number): number => (n / shown) * d.width;
  const r = px(9);        // 看得见的圆点
  const hit = px(23);     // 命中区 46px 直径 —— 手指按不准 18px 的点
  const pts = d.quad.map((p) => `${p.x},${p.y}`).join(' ');
  overlay.innerHTML =
    `<polygon class="edge" points="${pts}"/>` +
    d.quad.map((p) =>
      `<circle class="handle" cx="${p.x}" cy="${p.y}" r="${r}"/>`).join('') +
    // 命中区画在最上层，透明；视觉尺寸不变，可点区域大一倍多
    d.quad.map((p, i) =>
      `<circle class="grab" data-i="${i}" cx="${p.x}" cy="${p.y}" r="${hit}"/>`).join('');
}

/* ---- 拖动时的放大镜 ---- */
const magnifier = $<HTMLCanvasElement>('magnifier');
const MAG_ZOOM = 2.6;

/** 把被手指盖住的那个角显示到别处 */
function showMagnifier(imgX: number, imgY: number): void {
  const d = docs[active];
  if (!d) return;
  const rect = srcCanvas.getBoundingClientRect();
  if (!rect.width) return;
  const size = magnifier.width;                 // 位图边长
  const srcSize = size / MAG_ZOOM;              // 从原图取多大一块
  const ctx = magnifier.getContext('2d')!;
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

const hideMagnifier = (): void => { magnifier.hidden = true; };

let dragIdx = -1;
function toImg(evt: PointerEvent): Point {
  const d = docs[active]!;
  const rect = srcCanvas.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) / rect.width) * d.width,
    y: ((evt.clientY - rect.top) / rect.height) * d.height,
  };
}
stage.addEventListener('pointerdown', (e: PointerEvent) => {
  const h = (e.target as Element).closest?.('.grab') as SVGElement | null;
  if (!h) return;
  dragIdx = Number(h.dataset['i']);
  stage.setPointerCapture(e.pointerId);
  const p0 = docs[active]!.quad[dragIdx]!;
  showMagnifier(p0.x, p0.y);
  e.preventDefault();   // 阻止触屏上的滚动/长按选择
});
stage.addEventListener('pointermove', (e: PointerEvent) => {
  if (dragIdx < 0) return;
  const d = docs[active];
  if (!d) return;
  const p = toImg(e);
  d.quad[dragIdx] = {
    x: Math.max(0, Math.min(d.width, p.x)),
    y: Math.max(0, Math.min(d.height, p.y)),
  };
  drawHandles();
  showMagnifier(d.quad[dragIdx]!.x, d.quad[dragIdx]!.y);
  schedulePreview();
});
stage.addEventListener('pointerup', (e: PointerEvent) => {
  if (dragIdx < 0) return;
  dragIdx = -1;
  stage.releasePointerCapture?.(e.pointerId);
  hideMagnifier();
  drawHandles();
  schedulePreview(true);
});
stage.addEventListener('pointercancel', () => { dragIdx = -1; hideMagnifier(); });

// 横竖屏切换 / 窗口缩放后，px 与 viewBox 的比例变了，把手要重算
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
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
    const trustworthy = !!r.autoDetected && (r.coverage ?? 1) <= 0.82 && !!r.quad;
    d.quad = trustworthy ? r.quad! : defaultQuad(d.width, d.height);
    d.quad0 = d.quad.map((p) => ({ ...p }));
    d.autoDetected = trustworthy;
    if (!trustworthy) toast(t('err.detect'));
    updateDetectHint();
    drawHandles();
    schedulePreview(true);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
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
const defaultOpts = (): ProcessOpts => ({ grid: true, light: 1.0, colour: true });
/** 三个开关是 <r-checkbox>，读写它的 checked 属性 */
const box = (id: string): HTMLElementTagNameMap['r-checkbox'] =>
  document.getElementById(id) as HTMLElementTagNameMap['r-checkbox'];

const readOptsUI = (): ProcessOpts => ({
  grid: box('optGrid').checked,
  light: box('optLight').checked ? 1.0 : 0,
  colour: box('optColour').checked,
});
function writeOptsUI(o: ProcessOpts): void {
  box('optGrid').checked = o.grid;
  box('optLight').checked = o.light > 0;
  box('optColour').checked = o.colour;
}
const opts = (): ProcessOpts => docs[active]?.opts ?? defaultOpts();

for (const id of ['optGrid', 'optLight', 'optColour']) {
  // r-checkbox 派发 change，detail 里带 checked
  box(id).addEventListener('change', () => {
    const d = docs[active];
    if (d) d.opts = readOptsUI();
    schedulePreview(true);
  });
}

let previewToken = 0;
// 拖角点时高频触发，debounce 交给 ranuts/utils，不再自己管 timer
const debouncedPreview = debounce(() => { void runPreview(); }, 90);
function schedulePreview(immediate = false): void {
  if (immediate) { debouncedPreview.cancel?.(); void runPreview(); }
  else debouncedPreview();
}
async function runPreview(): Promise<void> {
  const d = docs[active];
  if (!d) return;
  const token = ++previewToken;
  busy(true);
  try {
    const r = await call({ type: 'preview', id: d.id, quad: d.quad, opts: d.opts || defaultOpts() });
    if (token !== previewToken) return;   // 拖拽中的旧结果直接丢掉
    if (!r.image) return;
    paint($<HTMLCanvasElement>('outCanvas'), r.image);
    // 画布编辑器要显示这一页，缓存预览分辨率的副本 —— 全分辨率留到导出
    d.preview = d.preview || document.createElement('canvas');
    paint(d.preview, r.image);
    if (isFree()) syncFreeItem(d);
    $('metaText').textContent =
      `${r.image.width}×${r.image.height}` +
      (r.lines ? `  ·  ${r.lines} ${i18n.locale === 'zh' ? '条线' : 'lines'}` : '');
    setStatus('step.done');
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  } finally {
    if (token === previewToken) busy(false);
  }
}
function paint(canvas: HTMLCanvasElement, imageData: ImageData): void {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d')!.putImageData(imageData, 0, 0);
}

/* ---------------- print layout ---------------- */
let layoutId = localStorage.getItem('flatpage.layout') || 'none';

function renderLayoutOpts(): void {
  const box = $('layoutOpts');
  box.innerHTML = '';
  for (const l of LAYOUTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'layout-opt' + (l.id === layoutId ? ' on' : '');
    b.innerHTML = layoutIcon(l) + `<span>${t(`layout.${l.id}` as keyof Messages)}</span>`;
    b.onclick = () => {
      layoutId = l.id;
      localStorage.setItem('flatpage.layout', layoutId);
      renderLayoutOpts();
      updateSheetCount();
      updateModeUI();
    };
    box.appendChild(b);
  }
}

/** 让用户先知道会印出几张纸，再点导出 */
function updateSheetCount(): void {
  const l = layoutById(layoutId);
  if (l.free) { $('sheetCount').textContent = docs.length ? fmt('layout.sheets', { n: 1 }) : ''; return; }
  const perPage = l.page ? (l.cols ?? 1) * (l.rows ?? 1) : 1;
  const sheets = Math.max(1, Math.ceil(docs.length / perPage));
  $('sheetCount').textContent = docs.length ? fmt('layout.sheets', { n: sheets }) : '';
}

/* ---------------- 自由排布画布 ---------------- */
let freeItems: FreeItem[] = [];      // box 是 0~1 的纸张比例
function isFree() { return layoutById(layoutId).free === true; }

/** 按当前页自动铺一遍。页数变了、或者用户点「重新自动排」时调用。 */
/** 惰性取，别在模块顶层就求值 */
const sheetEl = (): HTMLElement => $('sheet');

function autoArrangeAll(): void {
  const sizes = docs.map((d) => ({
    w: d.preview?.width || d.width,
    h: d.preview?.height || d.height,
  }));
  const boxes = autoArrange(sizes, A4);
  freeItems = docs.map((d, i) => ({ docId: d.id, box: boxes[i]! }));
  renderSheet();
}

/** 页集合和已有摆放对不上时（新增/删除页），重排 */
function ensureFreeItems(): void {
  const ids = docs.map((d) => d.id).join(',');
  const cur = freeItems.map((it) => it.docId).join(',');
  if (ids !== cur) autoArrangeAll();
}

function syncFreeItem(d: Doc): void {
  const el = sheetEl().querySelector<HTMLCanvasElement>(`[data-doc="${d.id}"] canvas`);
  if (el && d.preview) {
    el.width = d.preview.width;
    el.height = d.preview.height;
    el.getContext('2d')!.drawImage(d.preview, 0, 0);
  }
}

let selectedItem: string | null = null;

function renderSheet(): void {
  const sheet = sheetEl();
  sheet.innerHTML = '';
  for (const it of freeItems) {
    const d = docs.find((x) => x.id === it.docId);
    if (!d) continue;
    const el = document.createElement('div');
    el.className = 'c-item' + (selectedItem === it.docId ? ' on' : '');
    el.dataset.doc = d.id;
    el.style.left = `${it.box.x * 100}%`;
    el.style.top = `${it.box.y * 100}%`;
    el.style.width = `${it.box.w * 100}%`;
    el.style.height = `${it.box.h * 100}%`;
    const c = document.createElement('canvas');
    if (d.preview) {
      c.width = d.preview.width; c.height = d.preview.height;
      c.getContext('2d')!.drawImage(d.preview, 0, 0);
    }
    el.appendChild(c);
    const h = document.createElement('div');
    h.className = 'c-handle';
    el.appendChild(h);
    sheet.appendChild(el);
  }
}

/* 拖动 / 缩放：坐标一律换算成纸张比例，跟显示尺寸解耦 */
interface DragState {
  it: FreeItem;
  mode: 'move' | 'resize';
  px: number;
  py: number;
  box: Box;
  sheetW: number;
  sheetH: number;
}

let drag: DragState | null = null;
sheetEl().addEventListener('pointerdown', (e: PointerEvent) => {
  const target = e.target as Element | null;
  const el = target?.closest?.('.c-item') as HTMLElement | null;
  if (!el) {
    selectedItem = null;
    for (const n of sheetEl().querySelectorAll<HTMLElement>('.c-item')) n.classList.remove('on');
    return;
  }
  const it = freeItems.find((x) => x.docId === el.dataset['doc']);
  if (!it) return;
  selectedItem = it.docId;
  const r = sheetEl().getBoundingClientRect();
  drag = {
    it,
    mode: target?.classList.contains('c-handle') ? 'resize' : 'move',
    px: e.clientX, py: e.clientY,
    box: { ...it.box },
    sheetW: r.width, sheetH: r.height,
  };
  try { sheetEl().setPointerCapture(e.pointerId); } catch (_) { /* 合成事件没有真实指针 */ }
  // 只切选中样式，不要重建 DOM —— 重建会让正在拖的节点被换掉
  for (const n of sheetEl().querySelectorAll<HTMLElement>('.c-item')) {
    n.classList.toggle('on', n.dataset['doc'] === selectedItem);
  }
  e.preventDefault();
});
sheetEl().addEventListener('pointermove', (e: PointerEvent) => {
  if (!drag) return;
  const dx = (e.clientX - drag.px) / drag.sheetW;
  const dy = (e.clientY - drag.py) / drag.sheetH;
  const b = drag.box;
  const el = sheetEl().querySelector<HTMLElement>(`[data-doc="${drag.it.docId}"]`);
  if (drag.mode === 'move') {
    // 留在纸内。出界的部分打印时就是丢内容，不能让它悄悄发生。
    // 图比纸还大时反过来夹（允许负坐标），否则会被卡死在角上。
    const clamp = (v: number, size: number): number => (size >= 1
      ? Math.min(0, Math.max(1 - size, v))
      : Math.max(0, Math.min(1 - size, v)));
    drag.it.box.x = clamp(b.x + dx, b.w);
    drag.it.box.y = clamp(b.y + dy, b.h);
  } else {
    const ratio = b.h / b.w;                 // 等比缩放，证件不能变形
    // 上限按「宽或高先顶到纸边」算，放大到超出纸张没有意义
    const maxW = Math.min(1, 1 / ratio);
    const w = Math.max(0.06, Math.min(maxW, b.w + dx));
    drag.it.box.w = w;
    drag.it.box.h = w * ratio;
    drag.it.box.x = Math.max(0, Math.min(1 - w, drag.it.box.x));
    drag.it.box.y = Math.max(0, Math.min(1 - drag.it.box.h, drag.it.box.y));
  }
  if (el) {
    el.style.left = `${drag.it.box.x * 100}%`;
    el.style.top = `${drag.it.box.y * 100}%`;
    el.style.width = `${drag.it.box.w * 100}%`;
    el.style.height = `${drag.it.box.h * 100}%`;
  }
});
const endDrag = (e: PointerEvent): void => {
  if (!drag) return;
  drag = null;
  sheetEl().releasePointerCapture?.(e.pointerId);
};
sheetEl().addEventListener('pointerup', endDrag);
sheetEl().addEventListener('pointercancel', endDrag);

$('rearrangeBtn').onclick = () => { selectedItem = null; autoArrangeAll(); };
$('frontBtn').onclick = () => {
  if (!selectedItem) return;
  const i = freeItems.findIndex((x) => x.docId === selectedItem);
  const [moved] = freeItems.splice(i, 1);
  if (i >= 0 && moved) freeItems.push(moved);
  renderSheet();
};

/** 版式按钮 + 张数 + 画布模式，一起刷新。只能在模块所有定义之后调用。 */
function refreshChrome() {
  renderLayoutOpts();
  updateSheetCount();
  updateModeUI();
}

/**
 * 画布上每一页都要有图。预览只会为「当前选中页」生成，所以切到自由排布时
 * 得把其余页补上，否则它们在画布里是空框。用预览分辨率，快。
 */
async function ensureAllPreviews(): Promise<void> {
  const missing = docs.filter((d) => !d.preview);
  if (!missing.length) return;
  busy(true);
  try {
    for (let i = 0; i < missing.length; i++) {
      const d = missing[i]!;
      busy(true, `${t('out.progress')} ${i + 1}/${missing.length}`);
      const r = await call({ type: 'preview', id: d.id, quad: d.quad, opts: d.opts });
      if (!r.image) continue;
      d.preview = document.createElement('canvas');
      paint(d.preview, r.image);
      syncFreeItem(d);
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    busy(false);
  }
}

/** free 模式时用画布替换普通预览 */
function updateModeUI() {
  const free = isFree();
  $('sheetWrap').hidden = !free;
  const previewWrap = $('outCanvas').parentElement;
  if (previewWrap) previewWrap.hidden = free;
  if (free) {
    ensureFreeItems();
    renderSheet();
    ensureAllPreviews().then(() => { ensureFreeItems(); renderSheet(); });
  }
}

/* ---------------- export ---------------- */
/** 处理所有页并按当前版式排好，返回待导出的画布数组 */
async function renderAllComposed(): Promise<HTMLCanvasElement[]> {
  if (isFree()) {
    // 画布上摆的是预览图，导出时按同一套比例坐标重绘全分辨率
    const placed: { canvas: HTMLCanvasElement; box: Box }[] = [];
    for (let i = 0; i < freeItems.length; i++) {
      const it = freeItems[i]!;
      const d = docs.find((x) => x.id === it.docId);
      if (!d) continue;
      busy(true, `${t('out.progress')} ${i + 1}/${freeItems.length}`);
      placed.push({ canvas: await renderFull(d), box: it.box });
    }
    return composeFree(placed, A4);
  }
  const out = [];
  for (let i = 0; i < docs.length; i++) {
    busy(true, `${t('out.progress')} ${i + 1}/${docs.length}`);
    out.push(await renderFull(docs[i]!));
  }
  return compose(out, layoutId);
}

async function renderFull(d: Doc): Promise<HTMLCanvasElement> {
  const r = await call({ type: 'export', id: d.id, quad: d.quad, opts: d.opts });
  if (!r.image) throw new Error('导出没有返回图像');
  const c = document.createElement('canvas');
  paint(c, r.image);
  return c;
}
async function toJpegBlob(canvas: HTMLCanvasElement, quality = 0.95): Promise<Blob> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('canvas.toBlob 返回空');
  return blob;
}

function saveBlob(blob: Blob, name: string): void {
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
    const sheetCanvas = isFree()
      ? (await renderAllComposed())[0]
      // 选了版式就按版式出，跟「全部下载」的行为保持一致
      : compose([await renderFull(d)], layoutId)[0];
    if (!sheetCanvas) throw new Error('没有可导出的内容');
    const blob = await toJpegBlob(sheetCanvas);
    saveBlob(blob, `${d.name}_flat.jpg`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally { busy(false); }
};

// 逐张全分辨率处理并保存。浏览器对连续下载有节流，给每次之间留点间隔。
$('dlAllBtn').onclick = async () => {
  if (!docs.length) return;
  busy(true);
  try {
    const sheets = await renderAllComposed();
    const composed = layoutById(layoutId).page;
    for (let i = 0; i < sheets.length; i++) {
      const blob = await toJpegBlob(sheets[i]!);
      const name = composed ? `flatpage_${layoutId}_${i + 1}` : `${docs[i]?.name ?? 'page'}_flat`;
      saveBlob(blob, `${name}.jpg`);
      if (i < sheets.length - 1) await new Promise((r) => setTimeout(r, 350));
    }
    toast(fmt('out.savedAll', { n: sheets.length }));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally { busy(false); }
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
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally { busy(false); }
};

// 所有定义就绪之后再做首次渲染
refreshChrome();
