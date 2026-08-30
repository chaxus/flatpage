# FlatPage 的 OpenCV.js 白名单。
#
# 上游默认 build 把 dnn / objdetect / features2d / calib3d / photo / video / ml
# 全编进去，产出 12.7MB 的 wasm。FlatPage 只用 core 和 imgproc 里的十几个函数
# （见 src/pipeline.js）。这份白名单只保留那些。
#
# 用法见 tools/build-opencv.sh

core = {
    '': [
        'split',
        'merge',
    ],
    'Algorithm': [],
}

imgproc = {
    '': [
        # 几何
        'resize',
        'warpPerspective',
        'getPerspectiveTransform',
        'remap',
        # 颜色与增强
        'cvtColor',
        'equalizeHist',
        'GaussianBlur',
        # 二值化与形态学
        'adaptiveThreshold',
        'morphologyEx',
        'getStructuringElement',
        # 轮廓（自动找页面四角）
        'findContours',
        'approxPolyDP',
        'arcLength',
        'contourArea',
        'isContourConvex',
        # 连通域（表格横线检测）
        'connectedComponentsWithStats',
    ],
    'CLAHE': ['apply', 'collectGarbage', 'getClipLimit', 'setClipLimit'],
}

white_list = makeWhiteList([core, imgproc])
