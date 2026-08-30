# Build

## Layout

```
src/
  pipeline.js   OpenCV calls. The algorithm. Shared by worker and reference.
  worker.js     Runs the pipeline off the main thread. Owns the cv instance.
  app.js        UI: intake, corner editor, preview, export.
  pdf.js        Minimal PDF writer (one JPEG per page, DCTDecode).
  i18n.js       Bilingual copy. Single source for both languages.
tools/
  dewarp.py                    Python reference implementation of the pipeline.
  build-opencv.sh              Compiles the slim OpenCV wasm.
  opencv_js.flatpage.config.py Whitelist of OpenCV functions to expose.
  patch-opencv-umd.py          UMD -> ESM, export factory not result.
  measure-residual.py          The quality regression check.
vendor/opencv/  Committed build output. Do not edit by hand.
```

`vite.config.js` holds a build plugin that prerenders both languages. Copy is
never rendered at runtime for first paint — see "Bilingual" below.

## The OpenCV build

`vendor/opencv/` is committed, so a clone builds with no OpenCV compile. You
only need this section if you change which OpenCV functions the pipeline calls.

```bash
git clone --depth 1 --branch 4.x https://github.com/opencv/opencv.git
bash tools/build-opencv.sh path/to/opencv     # ~25 min
```

Requires `emscripten` (`brew install emscripten`) and `cmake`.

### Why a custom build

Upstream `opencv.js` bundles `dnn`, `objdetect`, `features2d`, `calib3d`,
`photo`, `video` and `ml`. This tool calls seventeen functions across `core`
and `imgproc`. Whitelisting only those and letting the linker drop the rest:
12.7 MB → 1.85 MB, and 3.65 MB → ~490 KB over the wire.

All module static libraries still compile — you will see `video` and
`objdetect` scroll past. Dead code elimination keeps them out of the final
wasm; only what the embind bindings reach survives.

### Two things that will bite you

**C++17.** emscripten 6.x needs C++17 for Embind; OpenCV 4.x still defaults to
C++11, and cmake fails outright. `build-opencv.sh` passes
`-DCMAKE_CXX_STANDARD=17`.

**The UMD wrapper breaks in dev only.** OpenCV emits UMD ending in
`return cv(Module)` — it calls the emscripten factory at module-evaluation
time and can only receive `locateFile` through a pre-existing global `Module`,
which ESM cannot provide. `patch-opencv-umd.py` rewrites it to plain ESM
exporting the factory itself.

Converting to ESM is not optional cleanup. With the UMD left in place the
production build works and **dev is broken**: `vendor/` is not in
`node_modules`, so Vite does not pre-bundle or CommonJS-transform it, and the
UMD falls through to a branch needing a defined top-level `this`. ESM has none.
Rollup's commonjs plugin hides this in the production build only.

### Adding an OpenCV call

Adding a `cv.something()` to `src/pipeline.js` requires adding it to
`tools/opencv_js.flatpage.config.py` and rebuilding. Otherwise it is missing at
runtime, not at build time — the failure surfaces as a rejected worker promise
and a toast, with nothing in the main-thread console.

## Bilingual

`src/i18n.js` holds both languages under one key each. `validate()` throws on a
missing side, and the build plugin calls it, so an untranslated string fails
the build rather than shipping.

The plugin fills every `data-i18n` element at build time and emits `/` and
`/zh/` with reciprocal hreflang, per-language canonical, and a sitemap. This
exists because rendering copy from JS left crawlers an empty `<h1>` — the
English page had no indexable content either, not just the Chinese one.

The language switch becomes a real `<a href>` in the build so crawlers follow
it; in dev it stays a button and swaps text in place.

## Deployment targets

`FLATPAGE_BASE` and `FLATPAGE_ORIGIN` drive every absolute path — asset URLs,
canonical, hreflang, JSON-LD, the language-switch link and the sitemap.

```bash
npm run build                                   # root path, flat.bybrowser.com
npm run build:pages                             # /flatpage/, github.io
```

A project site on GitHub Pages is served from `/<repo>/`. Building without
`FLATPAGE_BASE` and deploying there gives you a page whose every asset 404s and
whose canonical points somewhere else entirely.

```bash
npm run verify -- /flatpage/
```

`tools/verify-dist.py` is the single implementation of that check, called by CI
and locally. Do not inline verification into the workflow: an earlier inline
`grep -oE '[<CJK range>]'` passed under BSD grep on macOS and failed under GNU
grep in the runner's C locale, so a correct build failed CI.

## Verifying a change

Never judge the pipeline by looking at a screenshot. 1px and 3px of residual
curvature look identical to the eye and very different to OCR.

```bash
python3 tools/measure-residual.py out/whatever_flat.jpg
```

It measures how far the printed table lines still deviate from straight, and
exits non-zero above 3px mean. Baselines are in the script's docstring.

The end-to-end check is: process a bound-document photo in a real browser,
export at full resolution, and run the exported file through that script.
Preview and export are separate code paths — preview runs a 1000px thumbnail,
export runs full resolution — so verifying one says nothing about the other.
