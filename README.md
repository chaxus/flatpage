# FlatPage

Flatten curved photos of documents — entirely in your browser.

Photograph a booklet, a bound book or an ID page and you get back a warped,
shadowed, trapezoid image. FlatPage turns it into a flat, cropped, evenly-lit
scan. **Nothing is uploaded.** There is no server to upload to: the image is
decoded and processed by WebAssembly inside your tab, and the whole thing works
with the network switched off.

That last part is the point. People run documents like passports, ID pages and
household registers through tools like this. Those files should not travel.

## What it actually does

Four stages, in order:

1. **Find the page** — largest quadrilateral contour, which on a form or table
   lands on the printed border rather than the paper edge.
2. **Perspective correction** — four-point transform. Fixes the trapezoid and
   the tilt.
3. **Straighten the curve** — this is the part most tools skip. A four-point
   transform cannot undo the bend near a book's spine, because that bend is not
   a plane. FlatPage measures how far each ruled line or table border actually
   deviates from straight, builds a displacement field from it, and remaps.
4. **Even out the lighting** — a greyscale closing estimates the paper's own
   brightness across the page; dividing by it removes shadows and gradients.
   Only the L channel of LAB is touched, so red seals and stamps keep their
   colour. There is deliberately no binarisation: it destroys security
   watermarks and stamps.

### Measured

On a photo of a bound household register, curvature of the printed table
borders, before and after:

| | size | line deviation (mean / max) |
|---|---|---|
| original photo | 3024×4032 | **36.8px / 59.5px** |
| after FlatPage | 2690×2036 | **0.9px / 1.0px** |

Sub-pixel. The reference implementation in `tools/dewarp.py` produces the same
numbers, and is what the browser port is checked against.

## Why the ruled lines matter

General-purpose dewarping models (page_dewarp, DewarpNet, UVDoc, DocTr++) infer
the page's shape by fitting the flow of *text lines*. That is an inference, and
on a sparse form with handwriting and stamps it is a shaky one.

A form's table borders are different: they are *known* to be straight. Whatever
deviation you measure in them is the deformation, not an estimate of it. For
tables, forms, ID booklets and ruled paper, this beats the learned models —
without shipping a few hundred megabytes of weights to the browser.

For unruled prose the learned models remain the better tool; FlatPage falls back
to plain perspective correction there.

## Development

```bash
npm install
npm run dev
```

`tools/dewarp.py` is the reference CLI implementation (OpenCV, Python 3.12):

```bash
python dewarp.py IMG_0001.jpg -o out --grid --expand 1.2
```

## Privacy

- No upload, no server, no analytics on the processing path.
- `private-samples/` is gitignored — real documents used for testing never
  enter the repository. Check before you commit.

## License

MIT

---

# FlatPage 拍平

把拍弯的文档照片拉平 —— 全程在你的浏览器里完成。

拍一本户口本、一页装订的书、一张证件，得到的总是扭曲、带阴影、梯形的图。
FlatPage 把它变成裁切好、无阴影、不扭曲的扫描件。**没有上传**：这里没有
可上传的服务器，图片由标签页内的 WebAssembly 解码和处理，关掉网络照样能用。

这一点才是重点。人们会拿护照、身份证、户口本这类东西来用这种工具。这些文件
不应该离开本机。

## 它到底做了什么

四步：

1. **找到页面** —— 取最大的四边形轮廓。在表格类文档上，这会落在印刷框线上
   而不是纸张边缘，比找纸边可靠。
2. **透视校正** —— 四点变换，修梯形和倾斜。
3. **拉直弯曲** —— 这是多数工具跳过的一步。四点变换消不掉靠近书脊的弯曲，
   因为那不是一个平面。FlatPage 实测每条格线/表格框线偏离水平多少，据此构建
   位移场再 remap 回去。
4. **拉平光照** —— 用灰度闭运算估出纸张自身的亮度分布，除掉它就去掉了阴影和
   光照梯度。只动 LAB 的 L 通道，红色印章原样保留。刻意不做二值化 —— 那会毁掉
   防伪底纹和印章。

### 实测

一张装订户口本的照片，印刷表格线的弯曲度，处理前后：

| | 尺寸 | 横线起伏（平均 / 最大） |
|---|---|---|
| 原始照片 | 3024×4032 | **36.8px / 59.5px** |
| FlatPage 处理后 | 2690×2036 | **0.9px / 1.0px** |

亚像素级。`tools/dewarp.py` 里的参考实现给出相同的数字，浏览器版以它为基准校验。

## 为什么格线是关键

通用展平模型（page_dewarp、DewarpNet、UVDoc、DocTr++）靠拟合**文本行**的走向
来反推页面形状。那是一个推断 —— 在字段稀疏、混有手写和印章的表单上，是个不太
稳的推断。

表格框线不一样：它们**本来就该是直的**。在它们身上测到的偏差就是形变本身，
不是对形变的估计。对表格、表单、证件本、横格纸，这比学习模型更准，而且不用往
浏览器里塞几百 MB 的权重。

对没有格线的纯段落文字，学习模型仍然更强；FlatPage 在那种情况下退回到纯透视校正。

## 隐私

- 不上传、无服务器，处理链路上没有任何统计代码。
- `private-samples/` 已加入 gitignore —— 测试用的真实证件不会进仓库。提交前请自查。

## 许可

MIT
