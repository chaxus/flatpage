/**
 * 文档展平管线 —— OpenCV.js 移植版（对照 tools/dewarp.py）
 * 所有运算在浏览器内完成，图片不出本机。
 */
import type { CV, Mat } from '../types/opencv';

export interface Point {
  x: number;
  y: number;
}

/** 四角，顺序固定为 左上/右上/右下/左下 */
export type Quad = [Point, Point, Point, Point];

/** 附带「框占画面多少」，UI 用它判断这次自动识别可不可信 */
export interface DetectedQuad extends Array<Point> {
  coverage?: number;
}

export interface StraightenResult {
  mat: Mat;
  lines: number;
  maxWarp: number;
}

/** 四边形按 左上/右上/右下/左下 排序 */
export function orderQuad(pts: readonly Point[]): Point[] {
  const s = pts.map((p) => p.x + p.y);
  const d = pts.map((p) => p.x - p.y);
  const at = (arr: number[], fn: (...v: number[]) => number): Point =>
    pts[arr.indexOf(fn(...arr))]!;
  return [
    at(s, Math.min), // tl
    at(d, Math.max), // tr
    at(s, Math.max), // br
    at(d, Math.min), // bl
  ];
}

/** 相对中心放大 pct%，把卡太紧的检测框放开 */
export function expandQuad(quad: readonly Point[], pct: number): Point[] {
  if (!pct) return [...quad];
  const cx = quad.reduce((a, p) => a + p.x, 0) / 4;
  const cy = quad.reduce((a, p) => a + p.y, 0) / 4;
  const k = 1 + pct / 100;
  return quad.map((p) => ({ x: (p.x - cx) * k + cx, y: (p.y - cy) * k + cy }));
}

/**
 * 自动找页面四角。
 *
 * 三层，逐层放宽：
 *   1. 多组阈值参数下找规整的四边形轮廓（表格外框通常能直接命中）
 *   2. 找不到四边形，就取最大轮廓的最小外接矩形 —— 页面是矩形，即使轮廓被印章
 *      和折痕打断，外接矩形仍然接近真值
 *   3. 都失败返回 null，由调用方退回手动
 *
 * 面积上限很关键：拍文档时文档不会占满画面，一个占了 85% 以上的四边形几乎一定是
 * 整张图的边界或跨页本子的外轮廓，不是要裁的那一页。没有上限时它会赢过内部真正
 * 的表格框，用户看到的就是「框住了整张图」。
 *
 * 单一阈值参数不够：同一套参数在 OpenCV 5.0 上能命中的图，4.x 上会一个四边形都
 * 找不到（本仓库自建的是 4.x）。多组参数轮流试，成本只是几毫秒。
 */
export function findQuadAuto(
  cv: CV,
  src: Mat,
  minAreaFrac = 0.06,
  maxAreaFrac = 0.85,
): DetectedQuad | null {
  const scale = 1000 / Math.max(src.rows, src.cols);
  const small = new cv.Mat();
  cv.resize(src, small, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);

  const gray = new cv.Mat();
  cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
  try {
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(gray, gray);
    clahe.delete();
  } catch (e) {
    cv.equalizeHist(gray, gray); // 有些 build 不带 CLAHE
  }
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

  const frameArea = small.rows * small.cols;
  const minArea = minAreaFrac * frameArea;
  const maxArea = maxAreaFrac * frameArea;

  let result: { pts: Point[]; area: number } | null = null;
  let bestFallback: { mat: Mat; area: number } | null = null;

  for (const [block, C] of [[31, 10], [51, 12], [21, 8], [41, 6]]) {
    const bw = new cv.Mat();
    cv.adaptiveThreshold(gray, bw, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV, block, C);
    const k3 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.morphologyEx(bw, bw, cv.MORPH_CLOSE, k3, new cv.Point(-1, -1), 2);

    const contours = new cv.MatVector();
    const hier = new cv.Mat();
    cv.findContours(bw, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let best: { pts: Point[]; area: number } | null = null;
    let bestArea = minArea;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area >= minArea && area <= maxArea) {
        if (!bestFallback || area > bestFallback.area) {
          if (bestFallback) bestFallback.mat.delete();
          bestFallback = { mat: c.clone(), area };
        }
        if (area >= bestArea) {
          const peri = cv.arcLength(c, true);
          // eps 不要再放宽：0.08 会把不规则的大轮廓也近似成四边形，让它凭面积
          // 压过真正的表格框（实测会把一张原本正确的图框成完全不同的区域）
          for (const eps of [0.02, 0.03, 0.05]) {
            const ap = new cv.Mat();
            cv.approxPolyDP(c, ap, eps * peri, true);
            if (ap.rows === 4 && cv.isContourConvex(ap)) {
              const pts: Point[] = [];
              for (let j = 0; j < 4; j++) pts.push({ x: ap.intAt(j, 0), y: ap.intAt(j, 1) });
              best = { pts, area };
              bestArea = area;
              ap.delete();
              break;
            }
            ap.delete();
          }
        }
      }
      c.delete();
    }
    [bw, k3, contours, hier].forEach((m) => m.delete());
    if (best) { result = best; break; }
  }

  // 没有规整四边形：退到最大轮廓的最小外接矩形。页面本来就是矩形，印章和折痕
  // 打断轮廓时，外接矩形往往仍然接近真值 —— 比直接放弃、退回「整张图」好得多。
  if (!result && bestFallback) {
    const rot = cv.minAreaRect(bestFallback.mat);
    const box = cv.RotatedRect.points(rot);
    const area = rot.size.width * rot.size.height;
    if (area >= minArea && area <= maxArea) {
      result = { pts: box.map((p) => ({ x: p.x, y: p.y })), area };
    }
  }
  if (bestFallback) bestFallback.mat.delete();

  const coverage = result ? result.area / frameArea : 0;
  [small, gray].forEach((m) => m.delete());
  if (!result) return null;

  const quad: DetectedQuad = orderQuad(
    result.pts.map((p) => ({ x: p.x / scale, y: p.y / scale })),
  );
  quad.coverage = coverage;
  return quad;
}

/** 四点透视校正 */
export function warpQuad(cv: CV, src: Mat, quad: readonly Point[]): Mat {
  const [tl, tr, br, bl] = quad as [Point, Point, Point, Point];
  const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
  const w = Math.round(Math.max(dist(br, bl), dist(tr, tl)));
  const h = Math.round(Math.max(dist(tr, br), dist(tl, bl)));
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2,
    [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2,
    [0, 0, w - 1, 0, w - 1, h - 1, 0, h - 1]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const out = new cv.Mat();
  cv.warpPerspective(src, out, M, new cv.Size(w, h), cv.INTER_CUBIC,
    cv.BORDER_REPLICATE, new cv.Scalar());
  [srcTri, dstTri, M].forEach((m) => m.delete());
  return out;
}

/**
 * 用表格横线把残余弯曲拉直。
 * 横线本该是直的 —— 它弯了多少，就是该处的形变量。
 */
export function straightenRows(cv: CV, src: Mat, minLines = 4): StraightenResult {
  const h = src.rows, w = src.cols;
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const bw = new cv.Mat();
  cv.adaptiveThreshold(gray, bw, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV, 25, 10);
  const kx = Math.max(20, Math.floor(w / 30));
  const kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kx, 1));
  const horiz = new cv.Mat();
  cv.morphologyEx(bw, horiz, cv.MORPH_OPEN, kern);

  const labels = new cv.Mat(), stats = new cv.Mat(), cent = new cv.Mat();
  const n = cv.connectedComponentsWithStats(horiz, labels, stats, cent, 8);

  const CC_LEFT = 0, CC_WIDTH = 2;
  const keep = [];
  for (let i = 1; i < n; i++)
    if (stats.intAt(i, CC_WIDTH) >= 0.5 * w) keep.push(i);

  const cleanup = () =>
    [gray, bw, kern, horiz, labels, stats, cent].forEach((m) => m.delete());

  if (keep.length < minLines) {
    cleanup();
    return { mat: src.clone(), lines: keep.length, maxWarp: 0 };
  }

  // 采样区间取各线公共 x 跨度 —— 铺满全宽会让两侧页边的空 bin 废掉所有线
  const x0 = Math.max(...keep.map((i) => stats.intAt(i, CC_LEFT)));
  const x1 = Math.min(...keep.map((i) => stats.intAt(i, CC_LEFT) + stats.intAt(i, CC_WIDTH)));
  if (x1 - x0 < 0.4 * w) {
    cleanup();
    return { mat: src.clone(), lines: 0, maxWarp: 0 };
  }

  const NB = 48;
  const binOf = (x: number): number => {
    const b = Math.floor(((x - x0) / (x1 - x0)) * NB);
    return b < 0 || b >= NB ? -1 : b;
  };
  const slot = new Map<number, number>(keep.map((l, idx) => [l, idx]));
  const buckets: number[][] = Array.from({ length: keep.length * NB }, () => []);

  // labels 只遍历一次（5M+ 像素，遍历多次会明显卡）
  const lab = labels.data32S;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = x0; x < x1; x++) {
      const l = lab[row + x];
      if (!l) continue;                 // 0 = 背景；undefined 不会发生但类型上要排除
      const si = slot.get(l);
      if (si === undefined) continue;
      const bucketBase = si * NB;
      const b = binOf(x);
      if (b >= 0) buckets[bucketBase + b]!.push(y);
    }
  }

  const median = (a: number[]): number => {
    if (!a.length) return NaN;
    a.sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
  };

  const curves: number[][] = [];
  for (let si = 0; si < keep.length; si++) {
    const prof: number[] = [];
    let ok = true;
    for (let b = 0; b < NB; b++) {
      const arr = buckets[si * NB + b]!;
      if (arr.length < 3) { ok = false; break; }
      prof.push(median(arr));
    }
    if (ok) curves.push(prof);
  }
  if (curves.length < minLines) {
    cleanup();
    return { mat: src.clone(), lines: curves.length, maxWarp: 0 };
  }

  const mean = (a: readonly number[]): number => a.reduce((s2, v) => s2 + v, 0) / a.length;
  curves.sort((a, b) => mean(a) - mean(b));
  const y0 = curves.map(mean);
  const bx = Array.from({ length: NB },
    (_, b) => x0 + ((b + 0.5) * (x1 - x0)) / NB);

  // 沿 x 把每条线的偏移插值到全宽（范围外 clamp 成端点值）
  const interp1 = (xs: readonly number[], ys: readonly number[], x: number): number => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
    let i = 1;
    while (i < xs.length && xs[i]! < x) i++;
    const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
    return ys[i - 1]! * (1 - t) + ys[i]! * t;
  };
  const offs = curves.map((c, ci) => {
    const dy = c.map((v) => v - y0[ci]!);
    const row = new Float32Array(w);
    for (let x = 0; x < w; x++) row[x] = interp1(bx, dy, x);
    return row;
  });

  // 沿 y 插成完整位移场
  const mapX = new cv.Mat(h, w, cv.CV_32FC1);
  const mapY = new cv.Mat(h, w, cv.CV_32FC1);
  const mx = mapX.data32F, my = mapY.data32F;
  let maxWarp = 0;
  for (let y = 0; y < h; y++) {
    let i = 1;
    while (i < y0.length - 1 && y0[i]! < y) i++;
    const lo = y0[i - 1]!, hi = y0[i]!;
    const t = Math.min(1, Math.max(0, (y - lo) / Math.max(hi - lo, 1e-6)));
    const a = offs[i - 1]!, b = offs[i]!;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const d = a[x]! * (1 - t) + b[x]! * t;
      if (Math.abs(d) > maxWarp) maxWarp = Math.abs(d);
      mx[row + x] = x;
      my[row + x] = y + d;
    }
  }

  const out = new cv.Mat();
  cv.remap(src, out, mapX, mapY, cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
  cleanup();
  mapX.delete(); mapY.delete();
  return { mat: out, lines: curves.length, maxWarp };
}

/** 去阴影：只动 LAB 的 L 通道，颜色（红章）原样保留 */
export function flattenIllumination(cv: CV, src: Mat, strength = 1.0): Mat {
  if (strength <= 0) return src.clone();
  const rgb = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  const lab = new cv.Mat();
  cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
  const ch = new cv.MatVector();
  cv.split(lab, ch);
  const L = ch.get(0);

  // 灰度闭运算估计纸张本身的亮度分布（字和线被填掉，只剩光照）
  const sw = Math.max(16, (src.cols / 8) | 0), sh = Math.max(16, (src.rows / 8) | 0);
  const small = new cv.Mat();
  cv.resize(L, small, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);
  let k = Math.max(3, (Math.min(sw, sh) / 6) | 0);
  if (k % 2 === 0) k += 1;
  const kern = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k));
  cv.morphologyEx(small, small, cv.MORPH_CLOSE, kern);
  cv.GaussianBlur(small, small, new cv.Size(0, 0), Math.max(k / 3, 1));
  const bg = new cv.Mat();
  cv.resize(small, bg, new cv.Size(src.cols, src.rows), 0, 0, cv.INTER_LINEAR);

  const Ld = L.data, bd = bg.data;
  let sum = 0;
  for (let i = 0; i < bd.length; i++) sum += bd[i]!;
  const bgMean = sum / bd.length;
  for (let i = 0; i < Ld.length; i++) {
    const flat = (Ld[i]! / Math.max(bd[i]!, 1)) * bgMean;
    const v = Ld[i]! * (1 - strength) + flat * strength;
    Ld[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }

  cv.merge(ch, lab);
  const out = new cv.Mat();
  cv.cvtColor(lab, out, cv.COLOR_Lab2RGB);
  cv.cvtColor(out, out, cv.COLOR_RGB2RGBA);
  [rgb, lab, ch, L, small, kern, bg].forEach((m) => m.delete());
  return out;
}

/** 轻度拉对比。刻意不做二值化 —— 防伪底纹和印章要留住 */
export function enhance(cv: CV, src: Mat, loPct = 1.0, hiPct = 99.5): Mat {
  const rgb = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  const lab = new cv.Mat();
  cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
  const ch = new cv.MatVector();
  cv.split(lab, ch);
  const L = ch.get(0), Ld = L.data;

  const hist = new Uint32Array(256);
  for (let i = 0; i < Ld.length; i++) hist[Ld[i]!]!++;
  const total = Ld.length;
  const pct = (p: number): number => {
    let acc = 0, target = (p / 100) * total;
    for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= target) return v; }
    return 255;
  };
  const lo = pct(loPct), hi = pct(hiPct);
  if (hi - lo >= 1) {
    const g = 255 / (hi - lo);
    for (let i = 0; i < Ld.length; i++) {
      const v = (Ld[i]! - lo) * g;
      Ld[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  cv.merge(ch, lab);
  const out = new cv.Mat();
  cv.cvtColor(lab, out, cv.COLOR_Lab2RGB);
  cv.cvtColor(out, out, cv.COLOR_RGB2RGBA);
  [rgb, lab, ch, L].forEach((m) => m.delete());
  return out;
}
