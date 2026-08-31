/**
 * 自建 OpenCV wasm 产物的类型。
 * 放在产物旁边，TS 解析 `import from './opencv.js'` 时会自动配对同名 .d.ts。
 * 注意 tools/build-opencv.sh 只覆盖 opencv.js / opencv_js.wasm，不会动这个文件。
 */
import type { CV } from '../../types/opencv';

declare const cvFactory: (moduleOverrides?: Record<string, unknown>) => Promise<CV>;
export default cvFactory;
