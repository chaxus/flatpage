#!/usr/bin/env python3
"""
量一张成品图里「本该是直的横线」还剩多少弯曲。

这是这个项目唯一的客观质量指标。改了管线、换了 OpenCV build、调了参数之后，
用它对比数字，不要靠看截图 —— 肉眼分不出 1px 和 3px，但 OCR 和打印分得出。

用法:
    python3 tools/measure-residual.py 成品.jpg [更多.jpg ...]

依赖: opencv-python numpy
    python3 -m venv .venv && .venv/bin/pip install opencv-python numpy

已知基线（tools/dewarp.py 处理装订户口本照片，见 changelog/2026-08-30-initial.md）:
    原始照片          3024x4032   19 条线   36.8px / 59.5px
    Python 参考实现   2690x2036   11 条线    0.9px /  1.5px
    浏览器精简 build  2662x2020   11 条线    1.0px /  1.5px
"""
import sys

import cv2
import numpy as np


def residual(path):
    """返回 (宽, 高, 线数, 平均起伏, 最大起伏)；线太少返回 None。"""
    img = cv2.imread(path)
    if img is None:
        raise SystemExit(f"读不出: {path}")
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
    if len(keep) < 4:
        return None

    # 采样区间取各线公共 x 跨度（和 pipeline 里同样的理由：两侧页边会废掉整条线）
    x0 = max(stats[i, cv2.CC_STAT_LEFT] for i in keep)
    x1 = min(stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] for i in keep)
    edges = np.linspace(x0, x1, 49)

    devs = []
    for i in keep:
        ys, xs = np.where(labels == i)
        prof = []
        for b in range(48):
            m = (xs >= edges[b]) & (xs < edges[b + 1])
            if m.sum() >= 3:
                prof.append(np.median(ys[m]))
        if len(prof) >= 40:
            prof = np.asarray(prof)
            devs.append(prof.max() - prof.min())
    if not devs:
        return None
    return w, h, len(devs), float(np.mean(devs)), float(np.max(devs))


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    worst = 0.0
    for path in sys.argv[1:]:
        r = residual(path)
        if r is None:
            print(f"{path}: 找不到足够的长横线（图里没有表格/格线，或没裁切）")
            continue
        w, h, n, mean_d, max_d = r
        print(f"{path}")
        print(f"  {w}x{h}  {n} 条线  残余起伏 平均 {mean_d:.1f}px  最大 {max_d:.1f}px")
        worst = max(worst, mean_d)
    # 平均起伏超过 3px 说明拉直没起作用，值得当成回归
    if worst > 3.0:
        print(f"\n!! 平均起伏 {worst:.1f}px 超过 3px —— 拉直很可能没生效")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
