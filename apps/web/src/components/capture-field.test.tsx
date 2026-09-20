import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CaptureField } from './capture-field.js';
import { UploadPrepareError } from '../lib/image-compression.js';

const prepareUpload = vi.hoisted(() => vi.fn());

vi.mock('../lib/image-compression.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/image-compression.js')>();
  return { ...actual, prepareUpload };
});

function photo(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File([new Uint8Array(8)], name, { type });
}

function renderField(overrides: Partial<React.ComponentProps<typeof CaptureField>> = {}) {
  const onChange = vi.fn();
  const props = {
    id: 'scanFile',
    label: 'Photo of the sheet',
    accept: 'image/*',
    value: null as File | null,
    onChange,
    ...overrides,
  };
  const view = render(<CaptureField {...props} />);
  return { onChange, view, props };
}

beforeEach(() => {
  prepareUpload.mockReset();
  // jsdom defines neither of these, so they are added to the real URL object
  // rather than swapped in as a whole new global, which would lose the rest of
  // URL during React's unmount cleanup.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptureField', () => {
  // jsdom has no navigator.mediaDevices, which is the same shape as an
  // insecure origin or a device with no camera: the viewfinder must not be
  // the only way in. Every test below therefore exercises the fallback,
  // which is exactly the path that must never regress.
  it('falls back to the two file inputs when the viewfinder cannot open', () => {
    renderField();
    expect(screen.queryByTestId('scanFile-viewfinder')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
  });

  // The whole point of the change: one input forces the camera on mobile, so
  // the file-picker input must NOT carry the capture attribute.
  it('puts the camera attribute on the photo input only, so the other still opens the picker', () => {
    renderField();
    expect(screen.getByTestId('scanFile-camera')).toHaveAttribute('capture', 'environment');
    expect(screen.getByTestId('scanFile-file')).not.toHaveAttribute('capture');
  });

  it('hands up the prepared file, not the raw one the picker returned', async () => {
    const prepared = photo('capture.jpg');
    prepareUpload.mockResolvedValue(prepared);
    const { onChange } = renderField();

    await userEvent.upload(screen.getByTestId('scanFile-file'), photo('IMG_0001.HEIC', 'image/heic'));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(prepared));
  });

  it('explains a refused file and keeps the field empty rather than queueing it', async () => {
    prepareUpload.mockRejectedValue(new UploadPrepareError('file_too_large', 'too big'));
    const { onChange } = renderField();

    await userEvent.upload(screen.getByTestId('scanFile-camera'), photo());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That photo is too big to send');
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).not.toHaveBeenCalledWith(expect.any(File));
  });

  it('shows a preview and releases its object URL when the file is replaced', async () => {
    const { view, props } = renderField({ value: photo() });
    expect(screen.getByRole('img', { name: 'The sheet you captured' })).toBeInTheDocument();

    view.rerender(<CaptureField {...props} value={null} />);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('describes a PDF by name instead of trying to render it as an image', () => {
    renderField({
      accept: 'image/*,application/pdf',
      value: new File([new Uint8Array(2048)], 'sec-certificate.pdf', { type: 'application/pdf' }),
    });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/sec-certificate\.pdf/)).toBeInTheDocument();
  });

  it('clears the selection on Retake, which is what reopens the viewfinder', async () => {
    const { onChange } = renderField({ value: photo() });
    await userEvent.click(screen.getByRole('button', { name: 'Retake' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('hands a shutter frame through prepareUpload like any other file', async () => {
    const prepared = photo('capture.jpg');
    prepareUpload.mockResolvedValue(prepared);
    // A camera that opens: the viewfinder replaces the fallback buttons.
    const track = { stop: vi.fn(), getCapabilities: () => ({}) };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    // jsdom's <video> reports no frame and its canvas cannot encode, so both
    // are stubbed to the smallest thing the shutter needs.
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      value: 960,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      cb(new Blob([new Uint8Array(8)], { type: 'image/jpeg' }));
    });

    const { onChange } = renderField();
    const shutter = await screen.findByTestId('scanFile-shutter');
    await waitFor(() => expect(shutter).not.toBeDisabled());
    await userEvent.click(shutter);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(prepared));
    expect(prepareUpload).toHaveBeenCalledWith(expect.any(File));
    // The stream is released on capture, not left holding the camera open.
    expect(track.stop).toHaveBeenCalled();
  });
});
