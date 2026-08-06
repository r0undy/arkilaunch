import { PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';

// RFC-2 §6 (Locked): "content-type allowlist (image/pdf), max size,
// magic-byte sniff, and a decompression-bomb guard before the blob reaches
// Storage. A forged content-type is rejected, not extracted." This runs
// BEFORE apps/api/src/storage/storage.service.ts ever calls the Storage
// REST API -- exactly where the RFC puts it, on the API container, not
// after a direct-to-Storage signed upload.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // ~10MB; SDD §2 assumes client-compressed 1-3MB phone photos
const MAX_PDF_PAGES = 20;
const MAX_PNG_PIXELS = 50_000_000; // crude decompression-bomb guard: a tiny file claiming huge dimensions

const MAGIC_SIGNATURES: Record<string, Buffer> = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'application/pdf': Buffer.from('%PDF-', 'ascii'),
};

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

// Sniffs the ACTUAL content type from the file's magic bytes -- never trusts
// the client-supplied Content-Type/mimetype. Returns null when the bytes
// don't match anything in the allowlist.
function sniffContentType(buffer: Buffer): string | null {
  for (const [contentType, signature] of Object.entries(MAGIC_SIGNATURES)) {
    if (buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature)) {
      return contentType;
    }
  }
  return null;
}

export interface ValidatedUpload {
  contentType: string;
  extension: string;
}

// Throws a clean 4xx on any violation; never lets a forged/oversized/bomb
// upload reach uploadObject(). Callers pass a multer memory-storage file.
export function validateUpload(file: { buffer: Buffer; size: number } | undefined): ValidatedUpload {
  if (!file || file.buffer.length === 0) {
    throw new UnprocessableEntityException({ error: 'file_required' });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeException({ error: 'file_too_large', maxBytes: MAX_UPLOAD_BYTES });
  }

  const contentType = sniffContentType(file.buffer);
  if (!contentType) {
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

  return { contentType, extension: EXTENSION_BY_CONTENT_TYPE[contentType] ?? 'bin' };
}
