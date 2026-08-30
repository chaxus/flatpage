/**
 * 最小 PDF 生成器：每页嵌一张 JPEG。
 *
 * 用 DCTDecode 直接嵌入原始 JPEG 字节 —— 不解码、不重编码，所以既无损又快。
 * 这正是 jsPDF 在 addImage 里做的事，但那会连带拖进 html2canvas 和 dompurify
 * 共约 780KB，而我们只需要这一个功能。
 */

const enc = new TextEncoder();

/**
 * @param {{jpeg: Uint8Array, width: number, height: number}[]} pages
 * @returns {Blob}
 */
export function buildPdf(pages) {
  if (!pages.length) throw new Error('no pages');

  const parts = [];
  let len = 0;
  const push = (d) => {
    const b = typeof d === 'string' ? enc.encode(d) : d;
    parts.push(b);
    len += b.length;
  };

  const offsets = [];               // offsets[objNum] = 字节偏移
  const obj = (n, body, stream) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  // 头部第二行的高位字节标记，告诉工具这是二进制文件
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const N = pages.length;
  const pageNum = (i) => 3 + i * 3;
  const contentNum = (i) => 4 + i * 3;
  const imageNum = (i) => 5 + i * 3;

  const kids = pages.map((_, i) => `${pageNum(i)} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${N} >>`);

  pages.forEach((p, i) => {
    const w = p.width, h = p.height;
    obj(pageNum(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /XObject << /Im0 ${imageNum(i)} 0 R >> >> ` +
      `/Contents ${contentNum(i)} 0 R >>`);

    // 把图片铺满整页：cm 设置变换矩阵，Do 绘制
    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ`;
    obj(contentNum(i), `<< /Length ${content.length} >>`, enc.encode(content));

    obj(imageNum(i),
      `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${p.jpeg.length} >>`,
      p.jpeg);
  });

  const maxObj = 2 + N * 3;
  const xrefStart = len;
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObj; n++) {
    xref += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  }
  push(xref);
  push(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return new Blob(parts, { type: 'application/pdf' });
}

/** canvas -> JPEG 字节 */
export async function canvasToJpegBytes(canvas, quality = 0.92) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}
