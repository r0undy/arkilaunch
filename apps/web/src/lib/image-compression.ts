import { MAX_UPLOAD_BYTES } from '@arkilaunch/shared';

// Bandwidth guard only, never a security control: the server re-validates every upload.

// 2200px long edge keeps handwriting legible for Azure DI.
const DEFAULT_MAX_EDGE = 2200;
const DEFAULT_QUALITY = 0.82;
const RETRY_MAX_EDGE = 1600;
const RETRY_QUALITY = 0.7;
const MIN_QUALITY = 0.5;
const MIN_MAX_EDGE = 800;

export type UploadImageType = 'image/jpeg' | 'image/webp';

export interface PrepareUploadOptions {
  maxEdge?: number;
  quality?: number;
  type?: UploadImageType;
  maxBytes?: number;
}

export type UploadProblemCode = 'file_too_large' | 'unreadable_image' | 'unsupported_file_type';

export class UploadPrepareError extends Error {
  readonly code: UploadProblemCode;

  constructor(code: UploadProblemCode, message: string) {
    super(message);
    this.name = 'UploadPrepareError';
    this.code = code;
  }
}

export interface UploadProblem {
  readonly title: string;
  readonly detail: string;
}

export function describeUploadProblem(error: unknown): UploadProblem {
  const code = error instanceof UploadPrepareError ? error.code : null;
  switch (code) {
    case 'file_too_large':
      return {
        title: 'That photo is too big to send',
        detail:
          'Even after shrinking it, the file is still over the size limit. Take the photo again from a little further back, or pick a smaller file.',
      };
    case 'unsupported_file_type':
      return {
        title: 'That kind of file cannot be read',
        detail: 'Attach a photo (JPEG or PNG) or a PDF. Other file types are refused.',
      };
    case 'unreadable_image':
    default:
      return {
        title: 'That photo could not be opened',
        detail:
          'This browser could not read the image, which happens with some phone photo formats. Try taking the photo again, or pick a JPEG or PNG file instead.',
      };
  }
}

function encodeBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encodeAtScale(
  file: File,
  maxEdge: number,
  quality: number,
  type: UploadImageType = 'image/jpeg',
): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    // Bake EXIF rotation in: the extractor ignores the orientation tag.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new UploadPrepareError('unreadable_image', 'the browser could not decode this image');
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new UploadPrepareError('unreadable_image', 'no 2d canvas context available');
    }
    context.drawImage(bitmap, 0, 0, width, height);

    let outType = type;
    let blob = await encodeBlob(canvas, outType, quality);
    // toBlob silently returns PNG for a type it cannot encode (older Safari, WebP).
    if (blob && outType !== 'image/jpeg' && blob.type !== outType) {
      outType = 'image/jpeg';
      blob = await encodeBlob(canvas, outType, quality);
    }
    if (!blob) {
      throw new UploadPrepareError('unreadable_image', 'the browser produced no image data');
    }
    const name = outType === 'image/webp' ? 'capture.webp' : 'capture.jpg';
    return new File([blob], name, { type: outType, lastModified: Date.now() });
  } finally {
    bitmap.close?.();
  }
}

// EDTR and KYC call this with no options: Azure DI reads exactly those bytes, so the defaults must not drift.
export async function prepareUpload(file: File, options: PrepareUploadOptions = {}): Promise<File> {
  const {
    maxEdge = DEFAULT_MAX_EDGE,
    quality = DEFAULT_QUALITY,
    type = 'image/jpeg',
    maxBytes = MAX_UPLOAD_BYTES,
  } = options;

  // A canvas re-encode would destroy a PDF.
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > maxBytes) {
      throw new UploadPrepareError('file_too_large', 'pdf over the upload cap');
    }
    return file;
  }

  if (file.type !== '' && !file.type.startsWith('image/')) {
    throw new UploadPrepareError('unsupported_file_type', `content type ${file.type} is not accepted`);
  }

  let edge = Math.min(maxEdge, RETRY_MAX_EDGE);
  let q = Math.min(quality, RETRY_QUALITY);
  const rungs: Array<[edge: number, quality: number]> = [
    [maxEdge, quality],
    [edge, q],
  ];
  // Only a caller with its own byte cap steps further down: OCR is better served by a refusal than a mushier sheet.
  if (options.maxBytes !== undefined) {
    while (q > MIN_QUALITY) {
      q = Math.max(MIN_QUALITY, Math.round((q - 0.1) * 10) / 10);
      rungs.push([edge, q]);
    }
    while (edge > MIN_MAX_EDGE) {
      edge = Math.max(MIN_MAX_EDGE, Math.round(edge * 0.8));
      rungs.push([edge, q]);
    }
  }

  for (const [rungEdge, rungQuality] of rungs) {
    const prepared = await encodeAtScale(file, rungEdge, rungQuality, type);
    if (prepared.size <= maxBytes) return prepared;
  }

  throw new UploadPrepareError('file_too_large', 'still over the cap after the last attempt');
}
