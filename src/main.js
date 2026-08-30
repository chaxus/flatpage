import cvReady from '@techstark/opencv-js';
import { findQuadAuto, expandQuad, warpQuad, straightenRows,
         flattenIllumination, enhance } from './pipeline.js';

const el = document.getElementById('log');
const log = (s) => { el.textContent += '\n' + s; console.log(s); };
const T = {};
const tick = (k, fn) => { const t = performance.now(); const r = fn();
                          T[k] = Math.round(performance.now() - t); return r; };

(async () => {
  const t0 = performance.now();
  const cv = await cvReady;                      // 等 wasm 初始化
  window.__cv = cv;
  T.load = Math.round(performance.now() - t0);
  el.textContent = `opencv ${cv.version ? '' : ''}ready in ${T.load}ms`;

  const img = new Image();
  img.src = '/sample.jpg';
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  const src = cv.imread(c);
  log(`src ${src.cols}x${src.rows}`);

  try {
    let quad = tick('detect', () => findQuadAuto(cv, src));
    if (!quad) { log('!! detect FAILED'); window.__done = { ok:false, error:'detect' }; return; }
    log('quad ' + quad.map(p => `(${p.x|0},${p.y|0})`).join(' '));
    quad = expandQuad(quad, 1.2);

    const warped = tick('warp', () => warpQuad(cv, src, quad));
    log(`warped ${warped.cols}x${warped.rows}`);
    const sr = tick('grid', () => straightenRows(cv, warped));
    log(`grid ${sr.lines} lines, maxWarp ${sr.maxWarp.toFixed(1)}px`);
    const lit = tick('light', () => flattenIllumination(cv, sr.mat, 1.0));
    const fin = tick('enhance', () => enhance(cv, lit));
    cv.imshow('out', fin);

    const proc = T.detect + T.warp + T.grid + T.light + T.enhance;
    log('--- ms ---');
    for (const [k, v] of Object.entries(T)) log(`  ${k.padEnd(8)} ${v}`);
    log(`  PROCESS  ${proc}  (不含 wasm 加载)`);
    // 供比对：把结果导出成 dataURL
    const oc = document.getElementById('out');
    window.__resultDataURL = () => oc.toDataURL('image/jpeg', 0.95);
    window.__done = { ok:true, timings:T, proc, lines:sr.lines,
                      maxWarp:+sr.maxWarp.toFixed(1), size:[fin.cols, fin.rows],
                      contrastMode: findQuadAuto.contrastMode };
    [src, warped, sr.mat, lit, fin].forEach(m => m.delete());
  } catch (e) {
    log('!! ' + (e.stack || e));
    window.__done = { ok:false, error:String(e.message || e) };
  }
})();
