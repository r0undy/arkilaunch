export interface ScanPoint { x: number; y: number }
export type ScanCorners = [ScanPoint, ScanPoint, ScanPoint, ScanPoint];
export interface ScanResult {
  corners: ScanCorners;
  width: number;
  height: number;
  quality: 'ready' | 'dark' | 'glare' | 'blurry';
}

type Cv = typeof import('@techstark/opencv-js');
let cvPromise: Promise<Cv> | null = null;

// The pinned browser build is requested only when a KYC scanner opens.
export function loadDocumentScanner(): Promise<Cv> {
  cvPromise ??= new Promise<Cv>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/opencv-4.13.0.js';
    script.async = true;
    const timeout = setTimeout(() => { script.remove(); reject(new Error('Document scanner timed out')); }, 30_000);
    script.onload = () => {
      const runtime = (window as Window & { cv?: Cv }).cv;
      if (!runtime) { clearTimeout(timeout); reject(new Error('Document scanner did not initialize')); return; }
      const started = performance.now();
      const ready = () => {
        if (typeof runtime.Mat === 'function') {
          // This Emscripten build leaves a then method on the ready object.
          // Promise resolution would treat it as an unresolved thenable.
          Object.defineProperty(runtime, 'then', { value: undefined, configurable: true });
          clearTimeout(timeout);
          resolve(runtime);
        } else if (performance.now() - started < 20_000) {
          setTimeout(ready, 100);
        } else { clearTimeout(timeout); reject(new Error('Document scanner timed out')); }
      };
      ready();
    };
    script.onerror = () => { clearTimeout(timeout); reject(new Error('Document scanner could not load')); };
    document.head.append(script);
  }).catch((error: unknown) => {
    cvPromise = null;
    throw error;
  });
  return cvPromise;
}

function orderCorners(points: ScanPoint[]): ScanCorners {
  const sums = points.map((point) => point.x + point.y);
  const differences = points.map((point) => point.x - point.y);
  return [
    points[sums.indexOf(Math.min(...sums))]!,
    points[differences.indexOf(Math.max(...differences))]!,
    points[sums.indexOf(Math.max(...sums))]!,
    points[differences.indexOf(Math.min(...differences))]!,
  ];
}

function qualityOf(image: ImageData): ScanResult['quality'] {
  const { width, height, data } = image;
  let brightness = 0;
  let strongEdges = 0;
  let count = 0;
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const i = (y * width + x) * 4;
      const light = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      brightness += light;
      if (Math.abs(light - (data[i + 4]! + data[i + 5]! + data[i + 6]!) / 3) > 12) strongEdges++;
      count++;
    }
  }
  if (!count || brightness / count < 40) return 'dark';
  if (brightness / count > 248) return 'glare';
  return strongEdges / count < 0.002 ? 'blurry' : 'ready';
}

export function analyzeDocument(cv: Cv, image: ImageData): ScanResult | null {
  const source = cv.matFromImageData(image);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let best: { corners: ScanCorners; area: number } | null = null;
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 65, 160);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let index = 0; index < contours.size(); index++) {
      const contour = contours.get(index);
      const approx = new cv.Mat();
      try {
        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approx, perimeter * 0.025, true);
        if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
        const area = cv.contourArea(approx);
        const portion = area / (image.width * image.height);
        if (portion < 0.18 || portion > 0.9 || area <= (best?.area ?? 0)) continue;
        const corners = orderCorners(Array.from({ length: 4 }, (_, point) => ({
          x: approx.data32S[point * 2]!, y: approx.data32S[point * 2 + 1]!,
        })));
        if (corners.some(({ x, y }) => x < image.width * 0.02 || y < image.height * 0.02 || x > image.width * 0.98 || y > image.height * 0.98)) continue;
        best = { corners, area };
      } finally {
        approx.delete();
        contour.delete();
      }
    }
    return best && { ...best, width: image.width, height: image.height, quality: qualityOf(image) };
  } finally {
    source.delete(); gray.delete(); blurred.delete(); edges.delete(); contours.delete(); hierarchy.delete();
  }
}

export function cornersSteady(previous: ScanCorners, next: ScanCorners, width: number, height: number): boolean {
  const limit = Math.hypot(width, height) * 0.015;
  return previous.every((point, index) => Math.hypot(point.x - next[index]!.x, point.y - next[index]!.y) <= limit);
}

export function steadyHold(previous: ScanCorners | null, next: ScanCorners, since: number | null, now: number, width: number, height: number) {
  const startedAt = previous && cornersSteady(previous, next, width, height) ? (since ?? now) : now;
  const elapsed = now - startedAt;
  return { startedAt, progress: Math.min(1, elapsed / 2000), ready: elapsed >= 2000 };
}

export async function straightenDocument(source: HTMLCanvasElement, corners: ScanCorners): Promise<File> {
  const cv = await loadDocumentScanner();
  const distance = (a: ScanPoint, b: ScanPoint) => Math.hypot(a.x - b.x, a.y - b.y);
  const rawWidth = Math.max(distance(corners[0], corners[1]), distance(corners[3], corners[2]));
  const rawHeight = Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2]));
  const area = Math.abs(corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % 4];
    return sum + point.x * next!.y - next!.x * point.y;
  }, 0)) / 2;
  if (rawWidth < 100 || rawHeight < 100 || area < source.width * source.height * 0.05) {
    throw new Error('Document corners need more space');
  }
  const scale = Math.min(1, 2200 / Math.max(rawWidth, rawHeight));
  const width = Math.max(1, Math.round(rawWidth * scale));
  const height = Math.max(1, Math.round(rawHeight * scale));
  const input = cv.imread(source);
  const output = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(({ x, y }) => [x, y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);
  const transform = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(input, output, transform, new cv.Size(width, height));
    const canvas = document.createElement('canvas');
    cv.imshow(canvas, output);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!blob) throw new Error('Could not save the straightened photo');
    return new File([blob], `document-${Date.now()}.jpg`, { type: 'image/jpeg' });
  } finally {
    input.delete(); output.delete(); from.delete(); to.delete(); transform.delete();
  }
}
