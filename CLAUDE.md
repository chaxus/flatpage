# 在这个仓库里工作

浏览器内的文档展平工具。拍弯的证件/书页照片 → 裁正、拉直、去阴影的扫描件。
**全部运算在浏览器里，不上传** —— 这不是省服务器，是因为用户拿来处理户口本和护照。

## 开工前

```bash
npm install && npm run dev
cat changelog/$(ls changelog | tail -1)   # 上次会话发生了什么
```

构建流程、OpenCV 自编译、双语预渲染的细节在 [docs/BUILD.md](docs/BUILD.md)。

## 七条会伤人的规矩

1. **`private-samples/` 里是真实身份证件。** 已 gitignore，但提交前自己看一眼
   `git status`。这个仓库是公开的。

2. **往 `src/pipeline.js` 加 `cv.xxx()` 必须同步加白名单**
   （`tools/opencv_js.flatpage.config.py`）并重新编译 OpenCV。漏了不会构建失败，
   而是**运行时**才炸 —— 表现为一个 toast，主线程 console 里什么都没有。

3. **`vendor/opencv/*` 是打过补丁的产物，不要手动改，也不要直接从编译目录复制。**
   `opencv.js` 必须过 `tools/patch-opencv-umd.py`（UMD → ESM）。忘了这步生产构建
   照样能跑，**dev 白屏** —— 见 BUILD.md 里的原因。

4. **判断效果不要看截图。** 1px 和 3px 的残余弯曲肉眼一样，OCR 不一样。
   跑 `python3 tools/measure-residual.py 成品.jpg`，它超过 3px 会红。
   基线数字在 [changelog/2026-08-30-initial.md](changelog/2026-08-30-initial.md)。

5. **预览和导出是两条精度路径**（缩略图 vs 全分辨率）。**测一条不能说明另一条。**
   端到端验证 = 真浏览器里处理一张装订文档照片 + 导出 + 跑第 4 条的脚本。

6. **双语文案两边都要写**（`src/i18n.js` 一个 key 下并列）。缺一边 `validate()`
   会让构建失败。文案是构建时预渲染进 HTML 的，**不要改成运行时注入** ——
   那样爬虫看到的是空 `<h1>`，英文版也一样没内容。

7. **「生产能跑」和「dev 能跑」是两件事。** 已经在 UMD 上栽过一次：rollup 的
   commonjs 插件会遮住只在 dev 暴露的问题。改了 `vendor/` 或构建配置，两边都跑。

## 加东西时

| 你想加的 | 放哪 |
|---|---|
| 算法改动 | `src/pipeline.js`，并同步 `tools/dewarp.py` 参考实现 |
| 新的 OpenCV 调用 | 同上 + 白名单 + 重编译（见规矩 2） |
| 界面文案 | `src/i18n.js`，中英并列 |
| 构建流程的坑 | [docs/BUILD.md](docs/BUILD.md) |
| 本次会话干了什么 | `changelog/<日期>-<主题>.md` |

## 改完之前

```bash
npm run build                      # i18n 缺失 / 预渲染失败会在这里红
python3 tools/measure-residual.py <导出的成品>   # 超过 3px 会红
```

外加规矩 5 的浏览器端到端验证 —— 这一条没有脚本能替，必须真的跑一遍。

## 待办

- 域名未绑：canonical 已写死 `bybrowser.com`，现在指着不存在的地址。
- 无边框文档的自动检测不可靠，退回手动拖角点时缺少引导。
