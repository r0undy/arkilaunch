import { PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import { EQUIPMENT_PHOTO_MAX_BYTES, MAX_UPLOAD_BYTES } from '@arkilaunch/shared';

// RFC-2 §6 (Locked): "content-type allowlist (image/pdf), max size,
// magic-byte sniff, and a decompression-bomb guard before the blob reaches
// Storage. A forged content-type is rejected, not extracted." This runs
// BEFORE apps/api/src/storage/storage.service.ts ever calls the Storage
// REST API -- exactly where the RFC puts it, on the API container, not
// after a direct-to-Storage signed upload.

const MAX_PDF_PAGES = 20;
const MAX_PNG_PIXELS = 50_000_000; // crude decompression-bomb guard: a tiny file claiming huge dimensions

// What every caller accepted before WebP existed here. KYC and EDTR keep it
// exactly: Azure DI reads those bytes, and the web client only ever sends
// them a JPEG or an untouched PDF.
const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

// Images a browser renders directly. No PDF: a machine photo or a logo that
// is really a document is refused, not stored.
export const DISPLAY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const EQUIPMENT_PHOTO_RULES = { allow: DISPLAY_IMAGE_TYPES, maxBytes: EQUIPMENT_PHOTO_MAX_BYTES };

const MAGIC_SIGNATURES: Record<string, Buffer> = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'application/pdf': Buffer.from('%PDF-', 'ascii'),
};

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

// Sniffs the ACTUAL content type from the file's magic bytes -- never trusts
// the client-supplied Content-Type/mimetype. Returns null when the bytes
// don't match anything we know.
function sniffContentType(buffer: Buffer): string | null {
  for (const [contentType, signature] of Object.entries(MAGIC_SIGNATURES)) {
    if (buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature)) {
      return contentType;
    }
  }
  // WebP is a RIFF container: 'RIFF', a 4-byte size, then 'WEBP'.
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// Canvas pixel count from the first WebP chunk header, or null when the
// header is too short or not one of the three bitstream kinds. Same crude
// bomb guard as the PNG IHDR read below.
function webpPixels(buffer: Buffer): number | null {
  if (buffer.length < 30) return null;
  switch (buffer.toString('latin1', 12, 16)) {
    case 'VP8X': // extended: 24-bit (width-1) at 24, (height-1) at 27
      return (buffer.readUIntLE(24, 3) + 1) * (buffer.readUIntLE(27, 3) + 1);
    case 'VP8L': {
      // lossless: 14-bit (width-1) then 14-bit (height-1), from byte 21
      const bits = buffer.readUInt32LE(21);
      return ((bits & 0x3fff) + 1) * (((bits >>> 14) & 0x3fff) + 1);
    }
    case 'VP8 ': // lossy: 14-bit width at 26, height at 28
      return (buffer.readUInt16LE(26) & 0x3fff) * (buffer.readUInt16LE(28) & 0x3fff);
    default:
      return null;
  }
}

export interface ValidatedUpload {
  contentType: string;
  extension: string;
}

export interface UploadRules {
  /** Sniffed types this endpoint accepts. Defaults to JPEG, PNG and PDF. */
  allow?: readonly string[];
  /** Defaults to MAX_UPLOAD_BYTES. */
  maxBytes?: number;
}

// Throws a clean 4xx on any violation; never lets a forged/oversized/bomb
// upload reach uploadObject(). Callers pass a multer memory-storage file.
export function validateUpload(
  file: { buffer: Buffer; size: number } | undefined,
  { allow = DEFAULT_ALLOWED_TYPES, maxBytes = MAX_UPLOAD_BYTES }: UploadRules = {},
): ValidatedUpload {
  if (!file || file.buffer.length === 0) {
    throw new UnprocessableEntityException({ error: 'file_required' });
  }
  if (file.size > maxBytes) {
    throw new PayloadTooLargeException({ error: 'file_too_large', maxBytes });
  }

  // A real file of a type this endpoint does not take gets the same refusal
  // as a forged one: either way, nothing about it is stored.
  const contentType = sniffContentType(file.buffer);
  if (!contentType || !allow.includes(contentType)) {
    throw new UnprocessableEntityException({ error: 'unsupported_or_forged_content_type' });
  }

  if (contentType === 'application/pdf') {
    // Cheap heuristic (not a full PDF parser): counts /Type /Page object
    // markers, which is proportional to page count for the well-formed PDFs
    // a phone scanning app produces. Caps runaway page counts, the PDF
    // analogue of an image decompression bomb.
    const pageMarkers = file.buffer.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? [];
    if (pageMarkers.length > MAX_PDF_PAGES) {
      throw new UnprocessableEntityException({ error: 'pdf_too_many_pages', maxPages: MAX_PDF_PAGES });
    }
  }

  if (contentType === 'image/png' && file.buffer.length >= 24) {
    // PNG IHDR chunk: width/height are the first 8 bytes after the 8-byte
    // signature + 4-byte length + 4-byte "IHDR" tag (offset 16/20).
    const width = file.buffer.readUInt32BE(16);
    const height = file.buffer.readUInt32BE(20);
    if (width * height > MAX_PNG_PIXELS) {
      throw new UnprocessableEntityException({ error: 'image_dimensions_too_large' });
    }
  }

  if (contentType === 'image/webp' && (webpPixels(file.buffer) ?? 0) > MAX_PNG_PIXELS) {
    throw new UnprocessableEntityException({ error: 'image_dimensions_too_large' });
  }

  return { contentType, extension: EXTENSION_BY_CONTENT_TYPE[contentType] ?? 'bin' };
}
