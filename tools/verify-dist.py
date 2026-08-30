#!/usr/bin/env python3
"""
检查构建产物 —— 本地和 CI 跑同一份代码。

之前 CI 里的检查是内联 shell，和本地手敲的不是同一份，结果 `grep -oE '[一-龥]'`
在 macOS 的 BSD grep 下能用、在 CI 的 GNU grep + C locale 下报
"Invalid collation character" 并返回 0 匹配。本地全绿，CI 全红。

用法:
    python3 tools/verify-dist.py [dist 目录] [base 前缀]
    python3 tools/verify-dist.py dist /flatpage/
"""
import re
import sys
from pathlib import Path

def main():
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist')
    base = sys.argv[2] if len(sys.argv) > 2 else '/'
    if not base.startswith('/'):
        base = '/' + base
    if not base.endswith('/'):
        base += '/'

    errors = []
    def need(cond, msg):
        if not cond:
            errors.append(msg)
        return cond

    # 1. 必须存在的文件
    for rel in ['index.html', 'zh/index.html', 'sitemap.xml', 'robots.txt']:
        need((dist / rel).is_file(), f'缺文件: {rel}')
    need(list(dist.glob('assets/*.wasm')), '缺 OpenCV wasm')

    if errors:
        for e in errors:
            print(f'  FAIL  {e}')
        return 1

    en = (dist / 'index.html').read_text(encoding='utf-8')
    zh = (dist / 'zh/index.html').read_text(encoding='utf-8')

    # 2. 子路径部署最容易错的：资源前缀。
    #    判据是「站内绝对路径必须以 base 开头」—— 不能特判 /assets/，
    #    那样 base 为 / 时会把正确的路径判成错的。
    for name, html in (('index.html', en), ('zh/index.html', zh)):
        for attr in ('src', 'href'):
            for m in re.finditer(rf'{attr}="(/[^"]*)"', html):
                url = m.group(1)
                if not url.startswith(base):
                    errors.append(f'{name}: {url} 不在 base {base} 之下')
        need(f'src="{base}assets/' in html, f'{name}: 入口 JS 没带 base 前缀')

    # 3. 预渲染是否真的把文案填进去了。
    #    不数中文字符（locale 相关），直接看 h1 是不是空标签，
    #    并且两种语言必须不同 —— 相同说明 zh 版根本没换语言。
    def h1_of(html):
        m = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.S)
        return (m.group(1).strip() if m else '')

    h_en, h_zh = h1_of(en), h1_of(zh)
    need(len(h_en) >= 4, f'英文版 h1 是空的（预渲染失效）: {h_en!r}')
    need(len(h_zh) >= 4, f'中文版 h1 是空的（预渲染失效）: {h_zh!r}')
    need(h_en != h_zh, '两种语言的 h1 相同 —— 中文版没有真的切换语言')

    # 4. canonical / hreflang 必须指向本次部署的地址
    for name, html, want_path in (('index.html', en, base), ('zh/index.html', zh, base + 'zh/')):
        m = re.search(r'<link rel="canonical" href="([^"]+)"', html)
        need(m is not None, f'{name}: 没有 canonical')
        if m:
            need(m.group(1).endswith(want_path),
                 f'{name}: canonical {m.group(1)} 不指向 {want_path}')
        need('hreflang="zh-Hans"' in html and 'hreflang="en"' in html,
             f'{name}: hreflang 不完整')

    # 5. 语言切换必须是真链接（爬虫要能跟随），且带 base
    for name, html, want in (('index.html', en, f'{base}zh/'), ('zh/index.html', zh, base)):
        m = re.search(r'id="langBtn"[^>]*href="([^"]+)"', html)
        need(m is not None, f'{name}: 语言切换不是 <a href>（爬虫无法跟随）')
        if m:
            need(m.group(1) == want, f'{name}: 语言切换指向 {m.group(1)}，应为 {want}')

    if errors:
        for e in errors:
            print(f'  FAIL  {e}')
        return 1

    print(f'  产物检查通过  base={base}')
    print(f'    en h1: {h_en}')
    print(f'    zh h1: {h_zh}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
