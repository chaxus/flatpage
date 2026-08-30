# 在这个仓库里工作

浏览器内的文档展平工具。拍弯的证件/书页照片 → 裁正、拉直、去阴影的扫描件。
**全部运算在浏览器里，不上传** —— 这不是省服务器，是因为用户拿来处理户口本和护照。

## 开工前

```bash
npm install && npm run dev
cat changelog/$(ls changelog | tail -1)   # 上次会话发生了什么
```

构建流程、OpenCV 自编译、双语预渲染的细节在 [docs/BUILD.md](docs/BUILD.md)。

## 八条会伤人的规矩

1. **`private-samples/` 里是真实身份证件。** 已 gitignore，但提交前自己看一眼
   `git status`。这个仓库是公开的。

2. **往 `src/pipeline.js` 加 `cv.xxx()` 必须同步加白名单**
   （`tools/opencv_js.flatpage.config.py`）并重新编译 OpenCV。漏了不会构建失败，
   而是**运行时**才炸 —— 表现为一个 toast，主线程 console 里什么都没有。

3. **`vendor/opencv/*` 是打过补丁的产物，不要手动改，也不要直接从编译目录复制。**
   `opencv.js` 必须过 `tools/patch-opencv-umd.py`（UMD → ESM）。忘了这步生产构建
   照样能跑，**dev 白屏** —— 见 BUILD.md 里的原因。

4. **改检测参数必须两张样张都测。** 只测一张会漏掉回归 —— 为难例放宽
   approxPolyDP 容差曾让第二张成功、同时把第一张框成完全不同的区域，
   只看第二张会以为「修好了」。样张和预期数字在
   `private-samples/BASELINE.md`（该目录已 gitignore，里面是真实证件）。

5. **判断效果不要看截图。** 1px 和 3px 的残余弯曲肉眼一样，OCR 不一样。
   跑 `python3 tools/measure-residual.py 成品.jpg`，它超过 3px 会红。
   基线数字在 [changelog/2026-08-30-initial.md](changelog/2026-08-30-initial.md)。

6. **预览和导出是两条精度路径**（缩略图 vs 全分辨率）。**测一条不能说明另一条。**
   端到端验证 = 真浏览器里处理一张装订文档照片 + 导出 + 跑第 4 条的脚本。

7. **双语文案两边都要写**（`src/i18n.js` 一个 key 下并列）。缺一边 `validate()`
   会让构建失败。文案是构建时预渲染进 HTML 的，**不要改成运行时注入** ——
   那样爬虫看到的是空 `<h1>`，英文版也一样没内容。

8. **「生产能跑」和「dev 能跑」是两件事**，「本地能跑」和「CI 能跑」也是。
   已经各栽过一次：UMD 被 rollup 的 commonjs 插件遮住、只在 dev 炸；
   `grep -oE '[一-龥]'` 在 macOS 能用、在 CI 的 GNU grep + C locale 下报
   Invalid collation character。**验证逻辑只写一份**（`tools/verify-dist.py`），
   本地和 CI 调同一个，不要在 workflow 里内联 shell。

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
npm run build && npm run verify    # 产物结构 / base 前缀 / 预渲染 / canonical
python3 tools/measure-residual.py <导出的成品>   # 残余弯曲超过 3px 会红
```

子路径部署（GitHub Pages）要带 base 校验：

```bash
npm run build:pages && npm run verify -- /flatpage/
```

外加规矩 5 的浏览器端到端验证 —— 这一条没有脚本能替，必须真的跑一遍。

## 部署后别急着验证

CF Pages 有传播窗口：HTML 可能已更新而 assets 还没到，页面拿到 404 的样式表
（Content-Type 是 text/html，被浏览器按 MIME 拒绝）或 404 的入口 JS，整站看起来
是坏的，几秒后自愈。**已经因此误判过两次功能坏了。**

```bash
bash tools/wait-deploy.sh          # 查 HTML 引用的所有资源，含 Content-Type
```

只查入口 JS 不够 —— 第二次踩坑正是 JS 好了而 CSS 还没到。

## 验证离线时注意

**CDP / DevTools 的离线模拟不拦截经过 Service Worker 的请求。** 模拟离线后页面
照样能用，证明不了任何事。要判定离线是否真的工作，做对照实验：注销 SW + 清空
caches 后再离线导航，必须得到 `ERR_INTERNET_DISCONNECTED`。

**瞬时 UI（toast 3.6 秒）在自动化里抓不到**，靠 `console.debug` 留痕来确证。

## 待办

- 域名未绑：canonical 已写死 `flat.bybrowser.com`（子域，绑定中）。
- 无边框文档的自动检测不可靠，退回手动拖角点时缺少引导。
