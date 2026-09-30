import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES } from '@arkilaunch/shared';
import { DISPLAY_IMAGE_TYPES, EQUIPMENT_PHOTO_RULES, validateUpload } from './upload-validation.js';

const file = (buffer: Buffer) => ({ buffer, size: buffer.length });
const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as { getResponse(): { error: string } }).getResponse().error;
  }
  return null;
};

// A minimal lossless WebP header: RIFF, size, WEBP, VP8L chunk, signature
// byte, then 14-bit (width-1) and 14-bit (height-1) packed from byte 21.
function webp(width: number, height: number): Buffer {
  const buf = Buffer.alloc(40);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(32, 4);
  buf.write('WEBP', 8, 'latin1');
  buf.write('VP8L', 12, 'latin1');
  buf.writeUInt32LE(20, 16);
  buf[20] = 0x2f;
  buf.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return buf;
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n', 'latin1');

describe('validateUpload', () => {
  it('keeps the default allow-list exactly: JPEG, PNG, PDF, and no WebP', () => {
    expect(validateUpload(file(jpeg))).toEqual({ contentType: 'image/jpeg', extension: 'jpg' });
    expect(validateUpload(file(pdf))).toEqual({ contentType: 'application/pdf', extension: 'pdf' });
    expect(errorOf(() => validateUpload(file(webp(100, 100))))).toBe('unsupported_or_forged_content_type');
  });

  it('sniffs WebP from its RIFF/WEBP bytes and keys it .webp where allowed', () => {
    expect(validateUpload(file(webp(1920, 1440)), { allow: DISPLAY_IMAGE_TYPES })).toEqual({
      contentType: 'image/webp',
      extension: 'webp',
    });
  });

  it('does not take any RIFF container for a WebP', () => {
    const wav = webp(10, 10);
    wav.write('WAVE', 8, 'latin1');
    expect(errorOf(() => validateUpload(file(wav), { allow: DISPLAY_IMAGE_TYPES }))).toBe(
      'unsupported_or_forged_content_type',
    );
  });

  it('refuses a WebP claiming bomb-sized dimensions', () => {
    expect(errorOf(() => validateUpload(file(webp(16384, 16384)), { allow: DISPLAY_IMAGE_TYPES }))).toBe(
      'image_dimensions_too_large',
    );
  });

  it('holds equipment photos to images only and 1MB', () => {
    expect(validateUpload(file(jpeg), EQUIPMENT_PHOTO_RULES).contentType).toBe('image/jpeg');
    expect(validateUpload(file(webp(800, 600)), EQUIPMENT_PHOTO_RULES).contentType).toBe('image/webp');
    expect(errorOf(() => validateUpload(file(pdf), EQUIPMENT_PHOTO_RULES))).toBe('unsupported_or_forged_content_type');
    expect(errorOf(() => validateUpload({ buffer: jpeg, size: 1_000_001 }, EQUIPMENT_PHOTO_RULES))).toBe(
      'file_too_large',
    );
    // The same size is fine on the default (evidence) cap.
    expect(validateUpload({ buffer: jpeg, size: 1_000_001 }).contentType).toBe('image/jpeg');
    expect(errorOf(() => validateUpload({ buffer: jpeg, size: MAX_UPLOAD_BYTES + 1 }))).toBe('file_too_large');
  });
});
