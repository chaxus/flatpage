#!/usr/bin/env python3
"""
把 OpenCV 的 UMD 产物转成标准 ESM，并导出工厂函数本身。

两处都得改：

1. UMD 包装在 Vite dev 下是坏的。dev 不做 CommonJS 转换（vendor/ 不在
   node_modules，不会被 optimizeDeps 预打包），UMD 会走到 `root.cv = factory()`
   分支，而 ESM 顶层的 `this` 是 undefined。生产构建有 rollup commonjs 插件所以
   看不出来 —— 只有 dev 会炸。

2. UMD 尾部是 `return cv(Module)`，在模块求值时就把 emscripten 工厂调掉了，
   只能靠事先存在的全局 `Module` 传 locateFile。改成导出工厂，由调用方决定
   何时初始化、wasm 从哪儿取。
"""
import sys
from pathlib import Path

p = Path(sys.argv[1] if len(sys.argv) > 1 else 'vendor/opencv/opencv.js')
s = p.read_text()

MARK = 'PATCHED_BY_FLATPAGE'
if MARK in s:
    print('已打过补丁，跳过')
    sys.exit(0)

head = s.index('(function (root, factory) {')
body_start = s.index('}(this, function () {')
if head != 0:
    print('!! UMD 头部不在文件开头，OpenCV 版本可能变了', file=sys.stderr)
    sys.exit(1)

tail_old = """  if (typeof Module === 'undefined')
    Module = {};
  return cv(Module);
}));"""
if tail_old not in s:
    print('!! 没找到预期的 UMD 尾部，OpenCV 版本可能变了', file=sys.stderr)
    sys.exit(1)

inner = s[body_start + len('}(this, function () {'):s.index(tail_old)]

out = (
    f"// {MARK}: UMD -> ESM，并导出工厂而非调用结果（见 tools/patch-opencv-umd.py）\n"
    "const __cvFactory = (function () {\n"
    f"{inner}"
    "  return cv;\n"
    "})();\n"
    "export default __cvFactory;\n"
)
p.write_text(out)
print(f'已转为 ESM: {p}  ({len(out)/1024:.0f} KB)')
