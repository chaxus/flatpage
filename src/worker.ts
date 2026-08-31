/**
 * 处理 worker —— 所有 OpenCV 运算在这里跑，主线程只管画面。
 *
 * 两条精度路径：
 *   preview  在缩略图上跑（~200ms），拖角点时实时反馈
 *   export   全分辨率跑一次（~2.4s），只在导出时
 * 全分辨率每拖一次跑一遍是不可接受的，这是整个交互的性能前提。
 */
import cvFactory from '../vendor/opencv/opencv.js';
import wasmUrl from '../vendor/opencv/opencv_js.wasm?url';
import type { CV, Mat } from '../types/opencv';
import type { Point } from './pipeline';
import {
  findQuadAuto, expandQuad, warpQuad, straightenRows,
  flattenIllumination, enhance,
} from './pipeline.js';

const PREVIEW_MAX = 1000;

/** 处理参数。每页各自持有一份。 */
export interface ProcessOpts {
  grid: boolean;
  light: number;
  colour: boolean;
}

interface Doc {
  full: Mat;
  small: Mat;
  scale: number;
}

let cv: CV | null = null;
const docs = new Map<string, Doc>();

async function ensureCv(): Promise<CV> {
  if (cv) return cv;
  post({ type: 'status', stage: 'loading' });
  // 自建的精简 build：只含 core+imgproc 里用到的函数，1.7MB wasm（上游全模块是 12.7MB）
  const instance = await cvFactory({
    locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
  });
  cv = instance;
  post({ type: 'status', stage: 'ready' });
  return instance;
}

const post = (m: unknown, transfer: Transferable[] = []): void =>
  (self as unknown as Worker).postMessage(m, transfer);

function matFromBitmap(cvi: CV, bmp: ImageBitmap): Mat {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return cvi.matFromImageData(id);
}

function toImageData(cvi: CV, mat: Mat): ImageData {
  // Mat(RGBA) -> ImageData，可 transfer 回主线程
  const out = new cvi.Mat();
  if (mat.channels() === 3) cvi.cvtColor(mat, out, cvi.COLOR_RGB2RGBA);
  else mat.copyTo(out);
  const data = new Uint8ClampedArray(out.data);
  const img = new ImageData(data, out.cols, out.rows);
  out.delete();
  return img;
}

/** 完整管线。quad 用「原图坐标」，内部按 mat 的缩放折算 */
function run(
  cvi: CV, mat: Mat, quadFull: readonly Point[], scale: number, opts: ProcessOpts,
): { mat: Mat; lines: number; maxWarp: number } {
  const quad = quadFull.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  let cur = warpQuad(cvi, mat, quad);
  let lines = 0, maxWarp = 0;

  if (opts.grid) {
    const sr = straightenRows(cvi, cur);
    cur.delete();
    cur = sr.mat;
    lines = sr.lines;
    maxWarp = sr.maxWarp;
  }
  if (opts.light > 0) {
    const lit = flattenIllumination(cvi, cur, opts.light);
    cur.delete();
    cur = lit;
  }
  const fin = enhance(cvi, cur);
  cur.delete();

  if (!opts.colour) {
    const g = new cvi.Mat();
    cvi.cvtColor(fin, g, cvi.COLOR_RGBA2GRAY);
    cvi.cvtColor(g, fin, cvi.COLOR_GRAY2RGBA);
    g.delete();
  }
  return { mat: fin, lines, maxWarp };
}

self.onmessage = async (e: MessageEvent): Promise<void> => {
  const { type, id, reqId } = e.data as { type: string; id: string; reqId: number };
  try {
    const cvi = await ensureCv();

    if (type === 'load') {
      const full = matFromBitmap(cvi, e.data.bitmap as ImageBitmap);
      (e.data.bitmap as ImageBitmap).close?.();
      const scale = Math.min(1, PREVIEW_MAX / Math.max(full.cols, full.rows));
      const small = new cvi.Mat();
      cvi.resize(full, small, new cvi.Size(0, 0), scale, scale, cvi.INTER_AREA);
      docs.set(id, { full, small, scale });

      const quad = findQuadAuto(cvi, full);
      post({
        type: 'loaded', id, reqId,
        width: full.cols, height: full.rows,
        quad: quad ? quad.map((p: Point) => ({ x: p.x, y: p.y })) : null,
        autoDetected: !!quad,
        coverage: quad ? quad.coverage : 0,
      });
      return;
    }

    if (type === 'preview') {
      const d = docs.get(id);
      if (!d) return post({ type: 'error', id, reqId, message: 'doc not loaded' });
      const r = run(cvi, d.small, e.data.quad as Point[], d.scale, e.data.opts as ProcessOpts);
      const img = toImageData(cvi, r.mat);
      r.mat.delete();
      post({ type: 'preview', id, reqId, image: img, lines: r.lines,
             maxWarp: r.maxWarp }, [img.data.buffer]);
      return;
    }

    if (type === 'export') {
      const d = docs.get(id);
      if (!d) return post({ type: 'error', id, reqId, message: 'doc not loaded' });
      const r = run(cvi, d.full, e.data.quad as Point[], 1, e.data.opts as ProcessOpts);
      const img = toImageData(cvi, r.mat);
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
    post({ type: 'error', id, reqId, message: err instanceof Error ? err.message : String(err) });
  }
};
