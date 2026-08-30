/**
 * 固定版式拼版：把处理好的页排进 A4。
 *
 * 场景是「交材料」——户口本几页印在一张纸上、身份证正反面印一张。所以是固定
 * 版式而不是自由画布：选一个版式就出结果，不用手动摆。
 *
 * 单位统一用 300dpi 像素：A4 210×297mm -> 2480×3508。打印出来是实际尺寸。
 */

export const A4 = { w: 2480, h: 3508 };
export const A4_LANDSCAPE = { w: 3508, h: 2480 };

const MM = 300 / 25.4;             // 1mm 的像素数
const MARGIN = Math.round(10 * MM); // 10mm 页边距，多数打印机的安全区
const GAP = Math.round(6 * MM);     // 图之间的间隔

/** 版式定义。perPage 决定一张 A4 放几页。 */
export const LAYOUTS = [
  { id: 'none' },                                              // 不拼版，原样导出
  { id: 'a4-1', page: A4, cols: 1, rows: 1 },
  { id: 'a4-2', page: A4, cols: 1, rows: 2 },
  { id: 'a4-4', page: A4, cols: 2, rows: 2 },
  { id: 'a4-land-1', page: A4_LANDSCAPE, cols: 1, rows: 1 },
  { id: 'free', page: A4, free: true },                        // 自动铺好，之后可手动挪
];

export const layoutById = (id) => LAYOUTS.find((l) => l.id === id) || LAYOUTS[0];

/** 一页 A4 内的格子位置 */
export function slotsOf(layout) {
  const { page, cols, rows } = layout;
  const w = (page.w - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const h = (page.h - MARGIN * 2 - GAP * (rows - 1)) / rows;
  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({
        x: MARGIN + c * (w + GAP),
        y: MARGIN + r * (h + GAP),
        w, h,
      });
    }
  }
  return slots;
}

/**
 * 把源画布按 contain 放进格子：保持比例、居中、不裁切。
 * 交材料的件不能变形，也不能裁掉边角，所以是 contain 不是 cover。
 */
function drawContained(ctx, src, slot) {
  const scale = Math.min(slot.w / src.width, slot.h / src.height);
  const w = src.width * scale;
  const h = src.height * scale;
  ctx.drawImage(
    src,
    Math.round(slot.x + (slot.w - w) / 2),
    Math.round(slot.y + (slot.h - h) / 2),
    Math.round(w), Math.round(h),
  );
}

/**
 * 自由排布的初始摆放：按页数自动选一个够用的网格铺开，之后用户可以拖。
 * 返回的坐标是「相对纸张的比例」(0~1)，跟显示尺寸无关，导出时再乘回像素。
 */
export function autoArrange(sizes, page = A4) {
  const n = Math.max(1, sizes.length);
  const cols = n <= 1 ? 1 : n <= 2 ? 1 : n <= 4 ? 2 : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const slots = slotsOf({ page, cols, rows });
  return sizes.map((s, i) => {
    const slot = slots[i % slots.length];
    const scale = Math.min(slot.w / s.w, slot.h / s.h);
    const w = s.w * scale;
    const h = s.h * scale;
    return {
      x: (slot.x + (slot.w - w) / 2) / page.w,
      y: (slot.y + (slot.h - h) / 2) / page.h,
      w: w / page.w,
      h: h / page.h,
    };
  });
}

/**
 * 按自由摆放渲染一张纸。
 * @param {{canvas: HTMLCanvasElement, box: {x,y,w,h}}[]} placed box 是 0~1 比例
 */
export function composeFree(placed, page = A4) {
  const c = document.createElement('canvas');
  c.width = page.w;
  c.height = page.h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  for (const { canvas, box } of placed) {
    ctx.drawImage(canvas,
      Math.round(box.x * page.w), Math.round(box.y * page.h),
      Math.round(box.w * page.w), Math.round(box.h * page.h));
  }
  return [c];
}

/**
 * @param {HTMLCanvasElement[]} sources 处理好的页，按顺序
 * @param {string} layoutId
 * @returns {HTMLCanvasElement[]} 每个元素是一张排好的 A4
 */
export function compose(sources, layoutId) {
  const layout = layoutById(layoutId);
  if (!layout.page) return sources;      // 不拼版

  const slots = slotsOf(layout);
  const perPage = slots.length;
  const pages = [];

  for (let i = 0; i < sources.length; i += perPage) {
    const c = document.createElement('canvas');
    c.width = layout.page.w;
    c.height = layout.page.h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';            // 打印底色，别留透明
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';

    sources.slice(i, i + perPage).forEach((src, k) => drawContained(ctx, src, slots[k]));
    pages.push(c);
  }
  return pages;
}

/** 版式在 UI 上的示意图（纯 CSS 画不出比例，用 SVG） */
export function layoutIcon(layout) {
  if (!layout.page) return '';
  if (layout.free) {
    // 自由排布：画几个错开的框，跟规整网格区分开
    return '<svg width="16" height="22" viewBox="0 0 16 22" aria-hidden="true">'
      + '<rect x=".5" y=".5" width="15" height="21" rx="1.5" fill="none" stroke="currentColor" stroke-width="1"/>'
      + '<rect x="2.4" y="2.6" width="8" height="6" rx=".8" fill="currentColor" opacity=".35"/>'
      + '<rect x="5.6" y="9.6" width="8" height="5" rx=".8" fill="currentColor" opacity=".35"/>'
      + '<rect x="2.4" y="15.4" width="6.5" height="4.2" rx=".8" fill="currentColor" opacity=".35"/></svg>';
  }
  const { cols, rows, page } = layout;
  const land = page.w > page.h;
  const W = land ? 22 : 16, H = land ? 16 : 22;
  const pad = 2, gap = 1.2;
  const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
  const ch = (H - pad * 2 - gap * (rows - 1)) / rows;
  let cells = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells += `<rect x="${pad + c * (cw + gap)}" y="${pad + r * (ch + gap)}" `
             + `width="${cw}" height="${ch}" rx="0.8" fill="currentColor" opacity=".35"/>`;
    }
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">`
       + `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="1.5" `
       + `fill="none" stroke="currentColor" stroke-width="1"/>${cells}</svg>`;
}
