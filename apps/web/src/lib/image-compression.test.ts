import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  UploadPrepareError,
  describeUploadProblem,
  prepareUpload,
} from './image-compression.js';

// jsdom has no image decoder and no canvas raster, so the two browser calls
// that do the real work are stubbed. What is under test here is the decision
// logic around them: what passes through untouched, what gets a second, more
// aggressive attempt, and what is refused instead of being uploaded.

interface StubOptions {
  width?: number;
  height?: number;
  /** Bytes produced per toBlob call, in order. */
  sizes: number[];
  decodeFails?: boolean;
  /** false mimics older Safari: asked for WebP, it hands back a PNG. */
  webp?: boolean;
}

function stubBrowser({ width = 4000, height = 3000, sizes, decodeFails = false, webp = true }: StubOptions) {
  const drawn: Array<{ width: number; height: number }> = [];
  const encoded: Array<{ type: string; quality: number }> = [];
  const close = vi.fn();

  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      if (decodeFails) throw new Error('unsupported image format');
      return { width, height, close } as unknown as ImageBitmap;
    }),
  );

  let call = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: (_bitmap: unknown, _x: number, _y: number, w: number, h: number) => {
      drawn.push({ width: w, height: h });
    },
  } as unknown as CanvasRenderingContext2D);

  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb, type = 'image/png', quality) => {
    const size = sizes[Math.min(call, sizes.length - 1)] ?? 1;
    call += 1;
    encoded.push({ type, quality: quality as number });
    // jsdom derives Blob.size from its content, so the stub allocates the
    // exact byte count the case needs.
    const produced = type === 'image/webp' && !webp ? 'image/png' : type;
    cb(new Blob([new Uint8Array(size)], { type: produced }));
  });

  return { drawn, close, encoded };
}

function imageFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File([new Uint8Array(16)], name, { type });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('prepareUpload', () => {
  it('passes a PDF through untouched rather than re-encoding it through a canvas', async () => {
    const pdf = new File([new Uint8Array(32)], 'sec-certificate.pdf', { type: 'application/pdf' });
    const out = await prepareUpload(pdf);
    expect(out).toBe(pdf);
  });

  it('refuses a PDF over the upload cap without touching the network', async () => {
    const pdf = new File([], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(pdf, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    await expect(prepareUpload(pdf)).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('scales the long edge down to the cap and keeps the aspect ratio', async () => {
    const { drawn } = stubBrowser({ width: 4000, height: 3000, sizes: [1] });
    await prepareUpload(imageFile());
    expect(drawn[0]).toEqual({ width: 2200, height: 1650 });
  });

  it('does not upscale an image that is already small', async () => {
    const { drawn } = stubBrowser({ width: 800, height: 600, sizes: [1] });
    await prepareUpload(imageFile());
    expect(drawn[0]).toEqual({ width: 800, height: 600 });
  });

  it('re-encodes to JPEG whatever the camera handed us', async () => {
    stubBrowser({ sizes: [1] });
    const out = await prepareUpload(imageFile('IMG_0001.HEIC', 'image/heic'));
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('capture.jpg');
  });

  it('takes one more, more aggressive attempt before giving up on a heavy photo', async () => {
    // First encode lands over the cap, the retry rung lands under it.
    const { drawn } = stubBrowser({ width: 4000, height: 3000, sizes: [MAX_UPLOAD_BYTES + 1, 1024] });
    const out = await prepareUpload(imageFile());
    expect(drawn.map((d) => d.width)).toEqual([2200, 1600]);
    expect(out.size).toBe(1024);
  });

  it('refuses rather than uploading a photo that is still over the cap after the retry', async () => {
    stubBrowser({ sizes: [MAX_UPLOAD_BYTES + 1, MAX_UPLOAD_BYTES + 1] });
    await expect(prepareUpload(imageFile())).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('surfaces a decode failure as a readable problem, not a raw exception', async () => {
    stubBrowser({ sizes: [1], decodeFails: true });
    await expect(prepareUpload(imageFile('IMG_0001.HEIC', 'image/heic'))).rejects.toBeInstanceOf(UploadPrepareError);
    try {
      await prepareUpload(imageFile('IMG_0001.HEIC', 'image/heic'));
    } catch (err) {
      expect(describeUploadProblem(err).title).toBe('That photo could not be opened');
    }
  });

  it('refuses a file that does not even claim to be an image', async () => {
    stubBrowser({ sizes: [1] });
    const txt = new File([new Uint8Array(4)], 'notes.txt', { type: 'text/plain' });
    await expect(prepareUpload(txt)).rejects.toMatchObject({ code: 'unsupported_file_type' });
  });

  it('keeps the OCR defaults exactly when called with no options', async () => {
    const { drawn, encoded } = stubBrowser({ sizes: [MAX_UPLOAD_BYTES + 1, MAX_UPLOAD_BYTES + 1] });
    await expect(prepareUpload(imageFile())).rejects.toMatchObject({ code: 'file_too_large' });
    expect(drawn.map((d) => d.width)).toEqual([2200, 1600]);
    expect(encoded).toEqual([
      { type: 'image/jpeg', quality: 0.82 },
      { type: 'image/jpeg', quality: 0.7 },
    ]);
  });

  const EQUIPMENT = { maxEdge: 1920, quality: 0.8, type: 'image/webp', maxBytes: 1_000_000 } as const;

  it('encodes a WebP named .webp when the caller asks and the browser can', async () => {
    const { drawn, encoded } = stubBrowser({ sizes: [1] });
    const out = await prepareUpload(imageFile(), EQUIPMENT);
    expect(drawn[0]).toEqual({ width: 1920, height: 1440 });
    expect(encoded).toEqual([{ type: 'image/webp', quality: 0.8 }]);
    expect(out.type).toBe('image/webp');
    expect(out.name).toBe('capture.webp');
  });

  it('falls back to JPEG when the browser hands back something other than WebP', async () => {
    const { encoded } = stubBrowser({ sizes: [1], webp: false });
    const out = await prepareUpload(imageFile(), EQUIPMENT);
    expect(encoded.map((e) => e.type)).toEqual(['image/webp', 'image/jpeg']);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('capture.jpg');
  });

  it('keeps stepping down past the retry until the photo fits a caller byte cap', async () => {
    const over = 1_000_001;
    const { drawn, encoded } = stubBrowser({ sizes: [over, over, over, over, 900_000] });
    const out = await prepareUpload(imageFile(), EQUIPMENT);
    expect(out.size).toBe(900_000);
    expect(drawn.map((d) => d.width)).toEqual([1920, 1600, 1600, 1600, 1280]);
    expect(encoded.map((e) => e.quality)).toEqual([0.8, 0.7, 0.6, 0.5, 0.5]);
  });

  it('refuses once the stepping ladder bottoms out', async () => {
    const { drawn } = stubBrowser({ sizes: [2_000_000] });
    await expect(prepareUpload(imageFile(), EQUIPMENT)).rejects.toMatchObject({ code: 'file_too_large' });
    expect(drawn.at(-1)?.width).toBe(800);
  });

  it('holds a PDF to the caller byte cap too', async () => {
    const pdf = new File([new Uint8Array(32)], 'x.pdf', { type: 'application/pdf' });
    Object.defineProperty(pdf, 'size', { value: 1_000_001 });
    await expect(prepareUpload(pdf, EQUIPMENT)).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('releases the decoded bitmap even when encoding fails', async () => {
    const { close } = stubBrowser({ sizes: [1] });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null));
    await expect(prepareUpload(imageFile())).rejects.toBeInstanceOf(UploadPrepareError);
    expect(close).toHaveBeenCalled();
  });
});

describe('describeUploadProblem', () => {
  it('explains the size refusal in terms of what to do next', () => {
    const { title, detail } = describeUploadProblem(new UploadPrepareError('file_too_large', 'x'));
    expect(title).toBe('That photo is too big to send');
    expect(detail).toContain('further back');
  });

  it('falls back to the decode message for an error it does not recognise', () => {
    expect(describeUploadProblem(new Error('boom')).title).toBe('That photo could not be opened');
  });
});
