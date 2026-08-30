/**
 * 处理 worker —— 所有 OpenCV 运算在这里跑，主线程只管画面。
 *
 * 两条精度路径：
 *   preview  在缩略图上跑（~200ms），拖角点时实时反馈
 *   export   全分辨率跑一次（~2.4s），只在导出时
 * 全分辨率每拖一次跑一遍是不可接受的，这是整个交互的性能前提。
 */
import cvReady from '@techstark/opencv-js';
import {
  findQuadAuto, expandQuad, warpQuad, straightenRows,
  flattenIllumination, enhance,
} from './pipeline.js';

const PREVIEW_MAX = 1000;

let cv = null;
const docs = new Map(); // id -> { full: Mat, small: Mat, scale: number }

async function ensureCv() {
  if (cv) return cv;
  post({ type: 'status', stage: 'loading' });
  cv = await cvReady;
  post({ type: 'status', stage: 'ready' });
  return cv;
}

const post = (m, transfer) => self.postMessage(m, transfer || []);

function matFromBitmap(bmp) {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return cv.matFromImageData(id);
}

function toImageData(mat) {
  // Mat(RGBA) -> ImageData，可 transfer 回主线程
  const out = new cv.Mat();
  if (mat.channels() === 3) cv.cvtColor(mat, out, cv.COLOR_RGB2RGBA);
  else mat.copyTo(out);
  const data = new Uint8ClampedArray(out.data);
  const img = new ImageData(data, out.cols, out.rows);
  out.delete();
  return img;
}

/** 完整管线。quad 用「原图坐标」，内部按 mat 的缩放折算 */
function run(mat, quadFull, scale, opts) {
  const quad = quadFull.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  let cur = warpQuad(cv, mat, quad);
  let lines = 0, maxWarp = 0;

  if (opts.grid) {
    const sr = straightenRows(cv, cur);
    cur.delete();
    cur = sr.mat;
    lines = sr.lines;
    maxWarp = sr.maxWarp;
  }
  if (opts.light > 0) {
    const lit = flattenIllumination(cv, cur, opts.light);
    cur.delete();
    cur = lit;
  }
  const fin = enhance(cv, cur);
  cur.delete();

  if (!opts.colour) {
    const g = new cv.Mat();
    cv.cvtColor(fin, g, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(g, fin, cv.COLOR_GRAY2RGBA);
    g.delete();
  }
  return { mat: fin, lines, maxWarp };
}

self.onmessage = async (e) => {
  const { type, id, reqId } = e.data;
  try {
    await ensureCv();

    if (type === 'load') {
      const full = matFromBitmap(e.data.bitmap);
      e.data.bitmap.close?.();
      const scale = Math.min(1, PREVIEW_MAX / Math.max(full.cols, full.rows));
      const small = new cv.Mat();
      cv.resize(full, small, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
      docs.set(id, { full, small, scale });

      const quad = findQuadAuto(cv, full);
      post({
        type: 'loaded', id, reqId,
        width: full.cols, height: full.rows,
        quad, autoDetected: !!quad,
      });
      return;
    }

    if (type === 'preview') {
      const d = docs.get(id);
      if (!d) return post({ type: 'error', id, reqId, message: 'doc not loaded' });
      const r = run(d.small, e.data.quad, d.scale, e.data.opts);
      const img = toImageData(r.mat);
      r.mat.delete();
      post({ type: 'preview', id, reqId, image: img, lines: r.lines,
             maxWarp: r.maxWarp }, [img.data.buffer]);
      return;
    }

    if (type === 'export') {
      const d = docs.get(id);
      if (!d) return post({ type: 'error', id, reqId, message: 'doc not loaded' });
      const r = run(d.full, e.data.quad, 1, e.data.opts);
      const img = toImageData(r.mat);
      r.mat.delete();
      post({ type: 'export', id, reqId, image: img, lines: r.lines,
             maxWarp: r.maxWarp }, [img.data.buffer]);
      return;
    }

    if (type === 'free') {
      const d = docs.get(id);
      if (d) { d.full.delete(); d.small.delete(); docs.delete(id); }
      post({ type: 'freed', id, reqId });
      return;
    }
  } catch (err) {
    post({ type: 'error', id, reqId, message: String(err?.message || err) });
  }
};
