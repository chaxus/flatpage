#!/usr/bin/env bash
# 编译 FlatPage 专用的精简 OpenCV wasm。
#
# 上游 @techstark/opencv-js 是全模块 build，12.7MB wasm。我们只要 core+imgproc
# 里的十几个函数，白名单见 opencv_js.flatpage.config.py。
#
# 需要：emscripten (brew install emscripten)、cmake、python3
# 用法：bash tools/build-opencv.sh [opencv 源码目录]
set -euo pipefail

SRC="${1:-$HOME/Desktop/opencv-build/opencv}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../vendor/opencv"
BUILD="$SRC/../build_wasm"

command -v emcc >/dev/null || { echo "缺 emcc：brew install emscripten"; exit 1; }
[ -d "$SRC/platforms/js" ] || { echo "OpenCV 源码不在 $SRC"; exit 1; }

# macOS 的 readlink 没有 -f，配 set -e 会直接退出，所以走 brew 前缀
EMDIR="${EMSCRIPTEN_DIR:-}"
if [ -z "$EMDIR" ] && command -v brew >/dev/null; then
  EMDIR="$(brew --prefix emscripten 2>/dev/null)/libexec"
fi
[ -f "$EMDIR/cmake/Modules/Platform/Emscripten.cmake" ] || {
  echo "找不到 Emscripten.cmake，请设 EMSCRIPTEN_DIR"; exit 1; }

echo "== emscripten: $EMDIR"
echo "== 源码:       $SRC"
echo "== 输出:       $OUT"

# CMAKE_CXX_STANDARD=17: emscripten 6.x 的 Embind 要求 C++17，而 OpenCV 4.x
# 默认还是 C++11，不加这条 cmake 配置阶段就会直接失败。
python3 "$SRC/platforms/js/build_js.py" "$BUILD" \
  --build_wasm \
  --disable_single_file \
  --config "$HERE/opencv_js.flatpage.config.py" \
  --emscripten_dir "$EMDIR" \
  --cmake_option="-DCMAKE_CXX_STANDARD=17"

mkdir -p "$OUT"
cp "$BUILD/bin/opencv.js" "$OUT/"
cp "$BUILD/bin/opencv_js.wasm" "$OUT/"
python3 "$HERE/patch-opencv-umd.py" "$OUT/opencv.js"
ls -lh "$OUT"
