#!/usr/bin/env bash
# 等一次部署完全传播。
#
# 只查入口 JS 是不够的：CF Pages 的传播窗口里，HTML 可能已经更新而 CSS 还没到,
# 页面拿到 404 的样式表（MIME 是 text/html，被浏览器拒绝）。实测踩过。
# 这里把 HTML 里引用的所有本站资源都查一遍。
set -euo pipefail
URL="${1:-https://flat.bybrowser.com}"
DEADLINE=$(( $(date +%s) + 180 ))

while :; do
  html=$(curl -s "$URL/" --max-time 10 || true)
  refs=$(printf '%s' "$html" | grep -oE '(src|href)="/[^"]+\.(js|css|svg|webmanifest)"' \
         | sed -E 's/.*="([^"]+)"/\1/' | sort -u || true)
  [ -z "$refs" ] && { sleep 3; continue; }

  bad=0
  for r in $refs; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$URL$r" --max-time 10 || echo 000)
    ctype=$(curl -sI "$URL$r" --max-time 10 | awk 'BEGIN{IGNORECASE=1}/^content-type/{print $2}' | tr -d '\r' || true)
    # 404，或 .css/.js 却回了 text/html（SPA fallback 冒充成功）
    case "$r" in
      *.css) [ "$code" = 200 ] && [[ "$ctype" == text/css* ]] || bad=1 ;;
      *.js)  [ "$code" = 200 ] && [[ "$ctype" == *javascript* ]] || bad=1 ;;
      *)     [ "$code" = 200 ] || bad=1 ;;
    esac
  done

  if [ "$bad" = 0 ]; then
    echo "已完全传播（$(printf '%s' "$refs" | wc -l | tr -d ' ') 个资源全部就绪）"
    exit 0
  fi
  [ "$(date +%s)" -ge "$DEADLINE" ] && { echo "超时：仍有资源未传播"; exit 1; }
  sleep 4
done
