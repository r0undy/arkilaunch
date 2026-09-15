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

// MIRRORED PAIR: these two constants must stay in step with
// apps/api/src/storage/upload-validation.ts (MAX_UPLOAD_BYTES and the
// MAGIC_SIGNATURES allowlist). The server is authoritative; this copy exists
// only so the client can refuse early instead of wasting the upload.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

// A long edge of 2200px keeps handwriting legible for Azure DI while cutting a
// 12MP photo to roughly a tenth of its bytes. The retry rung is what a very
// dense or very noisy photo falls back to before we give up.
const DEFAULT_MAX_EDGE = 2200;
const DEFAULT_QUALITY = 0.82;
const RETRY_MAX_EDGE = 1600;
const RETRY_QUALITY = 0.7;

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
          'Even after shrinking it, the file is over 10MB. Take the photo again from a little further back, or pick a smaller file.',
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

export interface PrepareUploadOptions {
  maxEdge?: number;
  quality?: number;
}

async function encodeAtScale(file: File, maxEdge: number, quality: number): Promise<File> {
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

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    if (!blob) {
      throw new UploadPrepareError('unreadable_image', 'the browser produced no image data');
    }
    return new File([blob], 'capture.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bitmap.close?.();
  }
}

// Turns whatever the camera or the file picker handed us into something the
// API will accept, or throws an UploadPrepareError describing why it cannot.
export async function prepareUpload(file: File, opts: PrepareUploadOptions = {}): Promise<File> {
  // A PDF is passed through untouched. Re-encoding one through a canvas would
  // destroy it, and the KYC path legitimately accepts scanned corporate docs.
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new UploadPrepareError('file_too_large', 'pdf over the upload cap');
    }
    return file;
  }

  // A file that does not even claim to be an image gets the clearer message.
  // The decode below would refuse it anyway, so this only improves the copy.
  if (file.type !== '' && !file.type.startsWith('image/')) {
    throw new UploadPrepareError('unsupported_file_type', `content type ${file.type} is not accepted`);
  }

  const prepared = await encodeAtScale(file, opts.maxEdge ?? DEFAULT_MAX_EDGE, opts.quality ?? DEFAULT_QUALITY);
  if (prepared.size <= MAX_UPLOAD_BYTES) return prepared;

  // One more rung down before giving up, rather than bouncing the user for a
  // photo we could still have made fit.
  const retried = await encodeAtScale(file, RETRY_MAX_EDGE, RETRY_QUALITY);
  if (retried.size <= MAX_UPLOAD_BYTES) return retried;

  throw new UploadPrepareError('file_too_large', 'still over the cap after the second attempt');
}
