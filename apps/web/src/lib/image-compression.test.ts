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
}

function stubBrowser({ width = 4000, height = 3000, sizes, decodeFails = false }: StubOptions) {
  const drawn: Array<{ width: number; height: number }> = [];
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

  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
    const size = sizes[Math.min(call, sizes.length - 1)];
    call += 1;
    // jsdom derives Blob.size from its content, so the stub allocates the
    // exact byte count the case needs.
    cb(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
  });

  return { drawn, close };
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
