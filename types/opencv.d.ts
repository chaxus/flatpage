/**
 * 自建 OpenCV wasm 的类型。
 *
 * vendor/opencv/opencv.js 是编译产物（emscripten + UMD→ESM 补丁），没有类型。
 * 这里只声明本项目实际用到的那部分。cv 上的函数用索引签名兜底：白名单
 * (tools/opencv_js.flatpage.config.py) 才是真正的事实来源，在这里重复一遍
 * 反而会漂移。
 */

export interface Mat {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32S: Int32Array;
  data32F: Float32Array;
  channels(): number;
  clone(): Mat;
  copyTo(dst: Mat): void;
  delete(): void;
  intAt(row: number, col: number): number;
}

export interface MatVector {
  size(): number;
  get(i: number): Mat;
  delete(): void;
}

export interface Deletable {
  delete(): void;
}

export interface RotatedRect {
  size: { width: number; height: number };
}

export interface CLAHEInstance {
  apply(src: Mat, dst: Mat): void;
  delete(): void;
}

/** OpenCV 命名空间。常量和多数函数走索引签名 —— 见文件头的理由。 */
export interface CV {
  Mat: { new (): Mat; new (rows: number, cols: number, type: number): Mat };
  MatVector: { new (): MatVector };
  Size: { new (w: number, h: number): Deletable };
  Point: { new (x: number, y: number): Deletable };
  Scalar: { new (): Deletable };
  CLAHE: { new (clip: number, tile: unknown): CLAHEInstance };
  RotatedRect: { points(r: RotatedRect): { x: number; y: number }[] };
  matFromImageData(img: ImageData): Mat;
  matFromArray(rows: number, cols: number, type: number, arr: readonly number[]): Mat;
  minAreaRect(contour: Mat): RotatedRect;
  contourArea(c: Mat): number;
  arcLength(c: Mat, closed: boolean): number;
  isContourConvex(c: Mat): boolean;
  connectedComponentsWithStats(
    src: Mat, labels: Mat, stats: Mat, centroids: Mat, connectivity: number,
  ): number;
  getStructuringElement(shape: number, size: unknown): Mat;
  getPerspectiveTransform(src: Mat, dst: Mat): Mat;
  [key: string]: any;
}

declare module '*/opencv.js' {
  const factory: (moduleOverrides?: Record<string, unknown>) => Promise<CV>;
  export default factory;
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}
