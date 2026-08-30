/**
 * FlatPage — 主界面逻辑。
 * 所有 OpenCV 运算在 worker 里；这里只负责画面、拖拽和导出。
 */
import { makeT, detectLang, validate, STRINGS } from './i18n.js';

validate(); // 双语缺失就直接炸，别等上线才发现

const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

let lang = detectLang();
let t = makeT(lang);
const docs = [];        // { id, name, bitmap, width, height, quad, quad0, out, thumbUrl }
let active = -1;
let reqSeq = 0;
const pending = new Map();

/* ---------------- i18n / theme ---------------- */
function applyLang() {
  t = makeT(lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]').content = t('meta.desc');
  $('langBtn').textContent = lang === 'zh' ? 'EN' : '中文';
  if (active >= 0) setStatus('step.done');
}
$('langBtn').onclick = () => {
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
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3600);
}
function setStatus(key) { $('statusText').textContent = t(key); }
function busy(on) { $('busy').hidden = !on; if (on) $('busy').textContent = t('step.processing'); }

/* ---------------- worker bridge ---------------- */
worker.onmessage = (e) => {
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
};
function call(msg, transfer) {
  const reqId = ++reqSeq;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    worker.postMessage({ ...msg, reqId }, transfer || []);
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
                    height: bitmap.height, quad: null, out: null };
      docs.push(doc);
      const idx = docs.length - 1;
      // bitmap 要在 worker 和主线程都用，克隆一份再转移
      const forWorker = await createImageBitmap(bitmap);
      doc.bitmap = bitmap;
      const r = await call({ type: 'load', id, bitmap: forWorker }, [forWorker]);
      doc.quad = r.quad || defaultQuad(doc.width, doc.height);
      doc.quad0 = doc.quad.map((p) => ({ ...p }));
      doc.autoDetected = r.autoDetected;
      if (!r.autoDetected) toast(t('err.detect'));
      renderStrip();
      if (active < 0) select(idx); else renderStrip();
    } catch (err) {
      toast(/hei[cf]/i.test(f.name) ? t('err.heic') : t('err.decode'));
      console.error(err);
    }
  }
  document.body.classList.toggle('has-docs', docs.length > 0);
  $('work').hidden = docs.length === 0;
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
  renderStrip();
  drawSource();
  schedulePreview(true);
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
  // 把手半径按「显示尺寸 9px」反算回 viewBox 坐标，大图小图手感一致
  const shown = srcCanvas.getBoundingClientRect().width || srcCanvas.width;
  const r = (9 / Math.max(shown, 1)) * d.width;
  const pts = d.quad.map((p) => `${p.x},${p.y}`).join(' ');
  overlay.innerHTML =
    `<polygon class="edge" points="${pts}"/>` +
    d.quad.map((p, i) =>
      `<circle class="handle" data-i="${i}" cx="${p.x}" cy="${p.y}" r="${r}"/>`).join('');
}

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
  const h = e.target.closest?.('.handle');
  if (!h) return;
  dragIdx = +h.dataset.i;
  h.classList.add('on');
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
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
  schedulePreview();
});
stage.addEventListener('pointerup', (e) => {
  if (dragIdx < 0) return;
  dragIdx = -1;
  stage.releasePointerCapture?.(e.pointerId);
  drawHandles();
  schedulePreview(true);
});

$('resetBtn').onclick = () => {
  const d = docs[active]; if (!d) return;
  d.quad = d.quad0.map((p) => ({ ...p }));
  drawHandles(); schedulePreview(true);
};
$('fullBtn').onclick = () => {
  const d = docs[active]; if (!d) return;
  d.quad = [{ x: 0, y: 0 }, { x: d.width, y: 0 },
            { x: d.width, y: d.height }, { x: 0, y: d.height }];
  drawHandles(); schedulePreview(true);
};

/* ---------------- preview ---------------- */
const opts = () => ({
  grid: $('optGrid').checked,
  light: $('optLight').checked ? 1.0 : 0,
  colour: $('optColour').checked,
});
for (const id of ['optGrid', 'optLight', 'optColour']) {
  $(id).onchange = () => schedulePreview(true);
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
    const r = await call({ type: 'preview', id: d.id, quad: d.quad, opts: opts() });
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

/* ---------------- export ---------------- */
async function renderFull(d) {
  const r = await call({ type: 'export', id: d.id, quad: d.quad, opts: opts() });
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
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.95));
    saveBlob(blob, `${d.name}_flat.jpg`);
  } catch (e) { toast(e.message); } finally { busy(false); }
};

$('pdfBtn').onclick = async () => {
  if (!docs.length) return;
  busy(true);
  try {
    const { jsPDF } = await import('jspdf');
    let pdf = null;
    for (const d of docs) {
      const c = await renderFull(d);
      const url = c.toDataURL('image/jpeg', 0.92);
      const orient = c.width >= c.height ? 'l' : 'p';
      if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [c.width, c.height] });
      else pdf.addPage([c.width, c.height], orient);
      pdf.addImage(url, 'JPEG', 0, 0, c.width, c.height);
    }
    pdf.save('flatpage.pdf');
  } catch (e) { toast(e.message); console.error(e); } finally { busy(false); }
};
