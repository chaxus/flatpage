#!/usr/bin/env python3
"""
证件本 / 跨页文档照片 -> 裁正 + 展平 + 去阴影的单页图。

全程本地运行：不联网、不上传、不落盘任何 OCR 文本。

用法:
    python dewarp.py IMG_0001.jpg                 # 自动找表格外框
    python dewarp.py IMG_0001.jpg --manual        # 手动点四角（最可靠）
    python dewarp.py photos/ -o out/ --manual     # 批量
    python dewarp.py a.jpg --grid                 # 额外用表格线把弯曲拉直
    python dewarp.py a.jpg --rotate 270           # 页面是横躺的

手动模式：左键依次点【左上 -> 右上 -> 右下 -> 左下】四个角，
          u 撤销   r 重置   Enter/空格 确认   q 跳过这张
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

try:
    import pillow_heif
    from PIL import Image, ImageOps

    pillow_heif.register_heif_opener()
    _HEIF = True
except Exception:
    _HEIF = False

SUFFIXES = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".tif", ".tiff", ".webp"}


# ---------------------------------------------------------------- io

def imread_any(path: Path) -> np.ndarray:
    if path.suffix.lower() in {".heic", ".heif"}:
        if not _HEIF:
            raise RuntimeError("读 HEIC 需要 pillow-heif")
        im = ImageOps.exif_transpose(Image.open(path))  # cv2 会自动应用 EXIF，PIL 不会
        rgb = np.array(im.convert("RGB"))
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f"读不出图片: {path}")
    return img


# ---------------------------------------------------------- geometry

def order_quad(pts) -> np.ndarray:
    """排成 左上 / 右上 / 右下 / 左下。"""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = (pts[:, 0] - pts[:, 1])
    return np.array(
        [pts[np.argmin(s)], pts[np.argmax(d)], pts[np.argmax(s)], pts[np.argmin(d)]],
        dtype=np.float32,
    )


def expand_quad(quad: np.ndarray, pct: float) -> np.ndarray:
    """四边形相对自身中心放大 pct%，把卡得太紧的检测框放开。"""
    if pct == 0:
        return quad
    c = quad.mean(axis=0)
    return ((quad - c) * (1.0 + pct / 100.0) + c).astype(np.float32)


def warp_quad(img: np.ndarray, quad: np.ndarray) -> np.ndarray:
    tl, tr, br, bl = quad
    w = int(round(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl))))
    h = int(round(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl))))
    w, h = max(w, 10), max(h, 10)
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], np.float32)
    M = cv2.getPerspectiveTransform(quad, dst)
    return cv2.warpPerspective(
        img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )


def find_quad_auto(img: np.ndarray, min_area_frac: float = 0.06):
    """找最大的近四边形轮廓（优先命中表格黑外框）。找不到返回 None。"""
    scale = 1000.0 / max(img.shape[:2])
    small = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(2.0, (8, 8)).apply(gray)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    bw = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 10
    )
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=2)

    cnts, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    limit = min_area_frac * small.shape[0] * small.shape[1]
    best, best_area = None, limit
    for c in cnts:
        area = cv2.contourArea(c)
        if area < best_area:
            continue
        peri = cv2.arcLength(c, True)
        for eps in (0.02, 0.03, 0.05):
            ap = cv2.approxPolyDP(c, eps * peri, True)
            if len(ap) == 4 and cv2.isContourConvex(ap):
                best, best_area = ap, area
                break
    if best is None:
        return None
    return order_quad(best.reshape(4, 2).astype(np.float32) / scale)


def pick_quad_manual(img: np.ndarray, name: str):
    disp_max = 1100
    s = min(1.0, disp_max / max(img.shape[:2]))
    base = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    pts: list[tuple[int, int]] = []
    win = f"{name}  |  click TL-TR-BR-BL   u=undo r=reset Enter=ok q=skip"

    def redraw():
        canvas = base.copy()
        if len(pts) > 1:
            cv2.polylines(canvas, [np.array(pts)], len(pts) == 4, (0, 220, 0), 2)
        for i, p in enumerate(pts):
            cv2.circle(canvas, p, 6, (0, 0, 255), -1)
            cv2.putText(canvas, str(i + 1), (p[0] + 10, p[1] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        cv2.imshow(win, canvas)

    def on_mouse(ev, x, y, *_):
        if ev == cv2.EVENT_LBUTTONDOWN and len(pts) < 4:
            pts.append((x, y))
            redraw()

    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(win, on_mouse)
    redraw()
    while True:
        k = cv2.waitKey(20) & 0xFF
        if k == ord("u") and pts:
            pts.pop(); redraw()
        elif k == ord("r"):
            pts.clear(); redraw()
        elif k == ord("q"):
            cv2.destroyWindow(win); return None
        elif k in (13, 10, 32) and len(pts) == 4:
            break
    cv2.destroyWindow(win)
    return order_quad(np.array(pts, np.float32) / s)


# ------------------------------------------------------- grid dewarp

def straighten_rows(img: np.ndarray, min_lines: int = 4) -> np.ndarray:
    """用表格横线做基准，把残余弯曲（波浪形）在垂直方向拉直。

    表格横线本该是直的，实测它弯了多少 = 该处的形变量。比拟合文本行稳。
    """
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bw = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 10
    )
    kx = max(20, w // 30)
    horiz = cv2.morphologyEx(
        bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (kx, 1))
    )

    n, labels, stats, _ = cv2.connectedComponentsWithStats(horiz, 8)
    keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_WIDTH] >= 0.5 * w]
    if len(keep) < min_lines:
        print(f"    [grid] 只有 {len(keep)} 条长横线，跳过拉直", file=sys.stderr)
        return img

    # 采样区间取各线的公共 x 跨度 —— 铺满整个图宽会让两侧页边的空 bin 废掉所有线
    x0 = max(stats[i, cv2.CC_STAT_LEFT] for i in keep)
    x1 = min(stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] for i in keep)
    if x1 - x0 < 0.4 * w:
        print("    [grid] 横线公共跨度太窄，跳过拉直", file=sys.stderr)
        return img

    nb = 48
    edges = np.linspace(x0, x1, nb + 1)
    bx = (edges[:-1] + edges[1:]) / 2.0

    curves = []
    for i in keep:
        ys, xs = np.where(labels == i)
        prof, ok = [], True
        for b in range(nb):
            m = (xs >= edges[b]) & (xs < edges[b + 1])
            if m.sum() < 3:
                ok = False
                break
            prof.append(float(np.median(ys[m])))  # median: 抗交叉点和噪点
        if ok:
            curves.append(np.asarray(prof, np.float32))

    if len(curves) < min_lines:
        print(f"    [grid] 只有 {len(curves)} 条完整横线，跳过拉直", file=sys.stderr)
        return img

    curves.sort(key=lambda c: c.mean())
    y0 = np.array([c.mean() for c in curves], np.float32)
    # 每条线相对自身平均高度的偏移；np.interp 在 bx 范围外自动 clamp 成端点值
    offs = np.stack([np.interp(np.arange(w), bx, c - c.mean()) for c in curves])

    # 沿 y 把各线偏移插成完整位移场（向量化，别用 per-column 循环）
    yy = np.arange(h, dtype=np.float32)
    idx = np.clip(np.searchsorted(y0, yy), 1, len(y0) - 1)
    lo, hi = y0[idx - 1], y0[idx]
    t = np.clip((yy - lo) / np.maximum(hi - lo, 1e-6), 0.0, 1.0)[:, None]
    dy = (offs[idx - 1] * (1 - t) + offs[idx] * t).astype(np.float32)

    map_x, map_y = np.meshgrid(
        np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32)
    )
    print(f"    [grid] {len(curves)} 条横线，最大残余形变 {np.abs(dy).max():.1f}px")
    return cv2.remap(
        img, map_x, map_y + dy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )


def inset_crop(img: np.ndarray, pct: float) -> np.ndarray:
    """四边各内缩 pct%，裁掉框选溢出的页面黑边。"""
    if pct <= 0:
        return img
    h, w = img.shape[:2]
    dx, dy = int(w * pct / 100.0), int(h * pct / 100.0)
    if 2 * dx >= w or 2 * dy >= h:
        return img
    return img[dy:h - dy, dx:w - dx]


# ------------------------------------------------------ photometrics

def _estimate_background(L: np.ndarray) -> np.ndarray:
    """估计纸张本身的亮度分布（灰度闭运算，字和线被填掉，只剩光照）。"""
    h, w = L.shape
    small = cv2.resize(L, (max(w // 8, 16), max(h // 8, 16)), interpolation=cv2.INTER_AREA)
    k = max(3, (min(small.shape) // 6) | 1)
    bg = cv2.morphologyEx(
        small, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    )
    bg = cv2.GaussianBlur(bg, (0, 0), max(k / 3.0, 1.0))
    return cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR)


def flatten_illumination(img: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """除掉阴影 / 光照梯度。只动 L 通道，颜色（红章）原样保留。"""
    if strength <= 0:
        return img
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    L = lab[:, :, 0].astype(np.float32)
    bg = np.maximum(_estimate_background(L), 1.0)
    flat = L / bg * float(bg.mean())
    lab[:, :, 0] = np.clip(L * (1 - strength) + flat * strength, 0, 255).astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def enhance(img: np.ndarray, lo_pct: float = 1.0, hi_pct: float = 99.5) -> np.ndarray:
    """轻度拉对比。刻意不做二值化 —— 防伪底纹和印章要留住。"""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    L = lab[:, :, 0].astype(np.float32)
    lo, hi = np.percentile(L, (lo_pct, hi_pct))
    if hi - lo < 1:
        return img
    lab[:, :, 0] = np.clip((L - lo) * (255.0 / (hi - lo)), 0, 255).astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def rotate(img: np.ndarray, deg: int) -> np.ndarray:
    deg %= 360
    if deg == 0:
        return img
    return cv2.rotate(img, {90: cv2.ROTATE_90_CLOCKWISE,
                            180: cv2.ROTATE_180,
                            270: cv2.ROTATE_90_COUNTERCLOCKWISE}[deg])


def rotation_sheet(img: np.ndarray, path: Path) -> None:
    """输出 0/90/180/270 四宫格，用来确认该转哪个方向。"""
    tiles = []
    for d in (0, 90, 180, 270):
        t = rotate(img, d)
        s = 500.0 / max(t.shape[:2])
        t = cv2.resize(t, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        canvas = np.full((520, 520, 3), 30, np.uint8)
        y, x = (520 - t.shape[0]) // 2, (520 - t.shape[1]) // 2
        canvas[y:y + t.shape[0], x:x + t.shape[1]] = t
        cv2.putText(canvas, f"--rotate {d}", (12, 32),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
        tiles.append(canvas)
    sheet = np.vstack([np.hstack(tiles[:2]), np.hstack(tiles[2:])])
    cv2.imwrite(str(path), sheet)


# ------------------------------------------------------------- main

def process(path: Path, args, out_dir: Path) -> bool:
    print(f"\n== {path.name}")
    img = imread_any(path)
    print(f"   原图 {img.shape[1]}x{img.shape[0]}")

    quad = None
    if not args.manual:
        quad = find_quad_auto(img)
        print("   自动检测四角: " + ("成功" if quad is not None else "失败，转手动"))
    if quad is None:
        quad = pick_quad_manual(img, path.name)
        if quad is None:
            print("   跳过")
            return False

    quad = expand_quad(quad, args.expand)
    out = warp_quad(img, quad)
    print(f"   透视校正 -> {out.shape[1]}x{out.shape[0]}")

    out = rotate(out, args.rotate)
    out = inset_crop(out, args.inset)

    if args.grid:
        out = straighten_rows(out)

    out = flatten_illumination(out, args.light)
    out = enhance(out)

    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / f"{path.stem}_flat.jpg"
    cv2.imwrite(str(dst), out, [cv2.IMWRITE_JPEG_QUALITY, 95])
    print(f"   -> {dst}")

    if args.sheet:
        sp = out_dir / f"{path.stem}_rotations.jpg"
        rotation_sheet(out, sp)
        print(f"   -> {sp}  (四个方向对照，挑一个再用 --rotate 重跑)")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path, help="图片文件或目录")
    ap.add_argument("-o", "--out", type=Path, default=None, help="输出目录（默认 <input>/../out）")
    ap.add_argument("--manual", action="store_true", help="直接手动点四角，不做自动检测")
    ap.add_argument("--grid", action="store_true", help="用表格横线做二次拉直")
    ap.add_argument("--rotate", type=int, default=0, choices=[0, 90, 180, 270])
    ap.add_argument("--expand", type=float, default=0.0,
                    help="检测框向外放大百分比，防止边缘内容被切掉（如 2）")
    ap.add_argument("--inset", type=float, default=0.0,
                    help="四边各内缩百分比，裁掉框选溢出的页面黑边（如 0.8）")
    ap.add_argument("--light", type=float, default=1.0, help="去阴影强度 0~1")
    ap.add_argument("--sheet", action="store_true", help="额外输出四方向对照图")
    args = ap.parse_args()

    if args.input.is_dir():
        files = sorted(p for p in args.input.iterdir() if p.suffix.lower() in SUFFIXES)
        out_dir = args.out or args.input / "out"
    else:
        files = [args.input]
        out_dir = args.out or args.input.parent / "out"

    if not files:
        print("没找到图片", file=sys.stderr)
        return 1

    done = sum(process(f, args, out_dir) for f in files)
    print(f"\n完成 {done}/{len(files)}，输出在 {out_dir}")
    return 0 if done else 1


if __name__ == "__main__":
    raise SystemExit(main())
