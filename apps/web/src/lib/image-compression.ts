// RFC-002 §2 (Locked) specifies the capture step as "a `paper_ocr` image
// (compressed client-side)", and PRD-NFR8 / SDD NFR-7 / DSD §6 all repeat it:
// the client compresses before upload so a 12MP phone photo does not cross a
// 3 to 5 Mbps link whole. That compression was never built. This module is it.
//
// It also front-runs the server allowlist. A raw camera photo is routinely
// HEIC, which apps/api/src/storage/upload-validation.ts refuses with
// `unsupported_or_forged_content_type` AFTER the whole file has been uploaded.
// Decoding and re-encoding here turns that into a JPEG the server accepts, or
// into a local, readable refusal that costs no bandwidth at all.
//
// This is a convenience and a bandwidth guard, never a security control. The
// server still sniffs magic bytes and enforces its own caps on every request;
// nothing here is trusted by the API.

// MIRRORED PAIR: this cap must stay in step with MAX_UPLOAD_BYTES in
// apps/api/src/storage/upload-validation.ts. The server is authoritative; this
// copy exists only so the client can refuse early instead of wasting the
// upload. The type allowlist is not mirrored: everything this module emits is
// a JPEG, a WebP (only when a caller asks, which today is equipment photos) or
// an untouched PDF, so the server's list has nothing to duplicate.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// A long edge of 2200px keeps handwriting legible for Azure DI while cutting a
// 12MP photo to roughly a tenth of its bytes. The retry rung is what a very
// dense or very noisy photo falls back to before we give up.
const DEFAULT_MAX_EDGE = 2200;
const DEFAULT_QUALITY = 0.82;
const RETRY_MAX_EDGE = 1600;
const RETRY_QUALITY = 0.7;
// Floors for the stepping ladder below. Past these a photo is mush, and a
// refusal is more honest than uploading it.
const MIN_QUALITY = 0.5;
const MIN_MAX_EDGE = 800;

export type UploadImageType = 'image/jpeg' | 'image/webp';

export interface PrepareUploadOptions {
  /** Long-edge cap in px. Default 2200. */
  maxEdge?: number;
  /** Encoder quality, 0..1. Default 0.82. */
  quality?: number;
  /** Default JPEG. WebP falls back to JPEG where the browser cannot encode it. */
  type?: UploadImageType;
  /** Byte cap the output must fit. Default MAX_UPLOAD_BYTES. */
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

// Same shape explainEdtrError returns, so the existing toast call sites take
// it unchanged.
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
    // imageOrientation 'from-image' applies the EXIF rotation during decode,
    // so a sideways phone photo is stored upright rather than travelling with
    // an orientation tag the extractor ignores.
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
    // toBlob silently ignores a type it cannot encode and hands back a PNG
    // (older Safari does this for WebP). Trust the blob, not the request.
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

// Turns whatever the camera or the file picker handed us into something the
// API will accept, or throws an UploadPrepareError describing why it cannot.
// Called with no options by EDTR and KYC: Azure DI reads exactly those bytes,
// so the defaults are load-bearing and must not drift.
export async function prepareUpload(file: File, options: PrepareUploadOptions = {}): Promise<File> {
  const {
    maxEdge = DEFAULT_MAX_EDGE,
    quality = DEFAULT_QUALITY,
    type = 'image/jpeg',
    maxBytes = MAX_UPLOAD_BYTES,
  } = options;

  // A PDF is passed through untouched. Re-encoding one through a canvas would
  // destroy it, and the KYC path legitimately accepts scanned corporate docs.
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > maxBytes) {
      throw new UploadPrepareError('file_too_large', 'pdf over the upload cap');
    }
    return file;
  }

  // A file that does not even claim to be an image gets the clearer message.
  // The decode below would refuse it anyway, so this only improves the copy.
  if (file.type !== '' && !file.type.startsWith('image/')) {
    throw new UploadPrepareError('unsupported_file_type', `content type ${file.type} is not accepted`);
  }

  // One more rung down before giving up, rather than bouncing the user for a
  // photo we could still have made fit.
  let edge = Math.min(maxEdge, RETRY_MAX_EDGE);
  let q = Math.min(quality, RETRY_QUALITY);
  const rungs: Array<[edge: number, quality: number]> = [
    [maxEdge, quality],
    [edge, q],
  ];
  // A caller with its own byte cap (equipment photos, 1MB) keeps stepping
  // down, quality first, then size. The default path stops after the retry:
  // OCR is better served by a refusal than by a mushier sheet.
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
