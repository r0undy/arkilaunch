import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button } from './button.js';
import { describeUploadProblem, prepareUpload } from '../lib/image-compression.js';

// The "DTR Form Capture" view: a live viewfinder with an alignment frame, a
// shutter, a torch toggle and a folder button, matching the prototype.
//
// This supersedes the file-input-only decision in
// docs/cr-arkilaunch-camera-capture-split.md -- see
// docs/cr-arkilaunch-viewfinder-capture.md for why. What that Change Record
// got right is kept: the OS file picker is still here as its own deliberate
// button, so a timekeeper can attach a photo already on the phone and a KYC
// operator can attach a PDF.
//
// The viewfinder is never assumed. getUserMedia does not exist on an
// insecure origin and rejects when permission is denied or no camera is
// present; every one of those falls back to the original two-button file
// input, which is the path that has always worked.
//
// ponytail: no edge detection or auto-capture -- the frame is a static CSS
// guide. Add OpenCV.js (or a Sobel pass on a downscaled canvas) only if
// operators actually mis-frame sheets often enough to matter.

export interface CaptureFieldProps {
  id: string;
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
  accept: string;
  /** 'field' matches the 48px timekeeper-console touch target (DESIGN.md §4). */
  size?: 'default' | 'field';
  disabled?: boolean;
  /** Steadying hints shown beside the viewfinder. Omit for none. */
  tips?: { title: string; detail: string }[];
  /** What this scan is attached to, shown as the session panel. */
  sessionData?: { label: string; value: string }[];
}

// Torch lives behind a capability TypeScript's DOM lib does not model.
// Narrowed here rather than an `any` at each call site.
type TorchCapableTrack = Omit<MediaStreamTrack, 'getCapabilities'> & {
  getCapabilities?: () => { torch?: boolean };
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CaptureField({
  id,
  label,
  value,
  onChange,
  accept,
  size = 'default',
  disabled = false,
  tips,
  sessionData,
}: CaptureFieldProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ title: string; detail: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  // null while the viewfinder is still being asked for; a sentence once it is
  // known to be unavailable and the file inputs are the only path.
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  // The previous implementation created an object URL per selection and never
  // revoked one. Tying the URL to the current value and revoking on replace or
  // unmount keeps a long capture session from leaking every photo it saw.
  useEffect(() => {
    if (!value || value.type === 'application/pdf') {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [value]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLive(false);
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  // Hold the camera open only while there is nothing captured yet. A stream
  // left running keeps the phone's camera light on and drains the battery
  // through a whole review.
  useEffect(() => {
    if (value || disabled || cameraError !== null) return;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'This browser will not open the camera here - that needs a secure (https) connection.',
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const track = stream.getVideoTracks()[0] as unknown as TorchCapableTrack | undefined;
        setTorchAvailable(track?.getCapabilities?.().torch === true);
        setLive(true);
      } catch {
        if (!cancelled) {
          setCameraError(
            'The camera could not be opened, so use a photo already on this device instead.',
          );
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [value, disabled, cameraError, stopCamera]);

  async function hand(picked: File) {
    setProblem(null);
    setPreparing(true);
    try {
      const prepared = await prepareUpload(picked);
      onChange(prepared);
    } catch (err) {
      // Never leave a value and an error standing together: the field is
      // either holding something we will send, or it is empty and saying why.
      onChange(null);
      setProblem(describeUploadProblem(err));
    } finally {
      setPreparing(false);
    }
  }

  async function onPicked(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    // Reset both inputs so picking the same file twice still fires a change,
    // which is what "Retake" after a bad shot relies on.
    if (cameraRef.current) cameraRef.current.value = '';
    if (fileRef.current) fileRef.current.value = '';
    if (!picked) return;
    await hand(picked);
  }

  // Grab the frame at the sensor's own resolution: the sheet's small printed
  // numbers are the whole point, and prepareUpload downscales afterwards
  // under the EXIF and size rules already agreed.
  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.95),
    );
    if (!blob) {
      setProblem({
        title: 'The photo could not be taken',
        detail: 'Try again, or choose a photo already on this device.',
      });
      return;
    }
    stopCamera();
    await hand(new File([blob], `dtr-${Date.now()}.jpg`, { type: 'image/jpeg' }));
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  function clear() {
    setProblem(null);
    onChange(null);
  }

  const busy = preparing || disabled;

  return (
    <fieldset
      className="flex flex-col gap-3 border-0 p-0"
      aria-describedby={problem ? `${id}-problem` : undefined}
    >
      <legend className="mb-1 text-sm font-medium text-text">{label}</legend>

      <input
        ref={cameraRef}
        id={`${id}-camera`}
        data-testid={`${id}-camera`}
        type="file"
        accept={accept}
        capture="environment"
        className="sr-only"
        onChange={onPicked}
      />
      <input
        ref={fileRef}
        id={`${id}-file`}
        data-testid={`${id}-file`}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={onPicked}
      />

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex-1">
          {value ? (
            <div className="flex flex-col gap-2">
              {preview ? (
                <img
                  src={preview}
                  alt="The sheet you captured"
                  className="max-h-96 w-full rounded-sm border border-border object-contain"
                />
              ) : (
                <p className="text-sm text-text-muted">
                  {value.name} ({formatBytes(value.size)}) ready to send.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size={size} disabled={busy} onClick={clear}>
                  Retake
                </Button>
                <Button
                  variant="ghost"
                  size={size}
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  Choose a different file
                </Button>
              </div>
            </div>
          ) : cameraError !== null ? (
            // Fallback: exactly the two-button file input this screen had
            // before the viewfinder, plus a plain reason.
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text-muted">{cameraError}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size={size}
                  disabled={busy}
                  onClick={() => cameraRef.current?.click()}
                >
                  Take photo
                </Button>
                <Button
                  variant="secondary"
                  size={size}
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  Choose a file
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-md bg-black">
              <video
                ref={videoRef}
                data-testid={`${id}-viewfinder`}
                autoPlay
                playsInline
                muted
                className="aspect-[3/4] w-full object-cover sm:aspect-[4/3]"
              />
              {/* Alignment frame. Decorative, so the instruction below it is
                  what a screen reader actually gets. */}
              <div aria-hidden className="pointer-events-none absolute inset-6">
                <span className="absolute left-0 top-0 h-10 w-10 border-l-2 border-t-2 border-accent" />
                <span className="absolute right-0 top-0 h-10 w-10 border-r-2 border-t-2 border-accent" />
                <span className="absolute bottom-0 left-0 h-10 w-10 border-b-2 border-l-2 border-accent" />
                <span className="absolute bottom-0 right-0 h-10 w-10 border-b-2 border-r-2 border-accent" />
              </div>
              <p className="absolute inset-x-0 bottom-20 text-center text-xs uppercase tracking-wide text-white">
                Align the sheet inside the frame
              </p>
              <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-6">
                {torchAvailable && (
                  <Button
                    variant="ghost"
                    size="field"
                    onClick={toggleTorch}
                    aria-pressed={torchOn}
                    className="text-white"
                  >
                    {torchOn ? 'Light off' : 'Light on'}
                  </Button>
                )}
                <button
                  type="button"
                  data-testid={`${id}-shutter`}
                  onClick={shoot}
                  disabled={busy || !live}
                  aria-label="Take the photo"
                  className="h-16 w-16 rounded-full border-4 border-accent bg-white disabled:opacity-50"
                />
                <Button
                  variant="ghost"
                  size="field"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                  className="text-white"
                >
                  Choose a file
                </Button>
              </div>
            </div>
          )}
        </div>

        {(tips?.length || sessionData?.length) && (
          <div className="flex flex-col gap-4 lg:w-72">
            {tips && tips.length > 0 && (
              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-sm font-semibold text-text">Scanning tips</p>
                <ol className="flex flex-col gap-2">
                  {tips.map((tip) => (
                    <li key={tip.title} className="text-sm">
                      <span className="font-medium text-text">{tip.title}.</span>{' '}
                      <span className="text-text-muted">{tip.detail}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {sessionData && sessionData.length > 0 && (
              <dl className="rounded-md border border-border p-3">
                {sessionData.map((row) => (
                  <div key={row.label} className="flex justify-between gap-3 py-1 text-sm">
                    <dt className="text-text-muted">{row.label}</dt>
                    <dd className="text-right text-text">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>

      {preparing && (
        <p role="status" className="text-sm text-text-muted">
          Preparing the photo for upload...
        </p>
      )}

      {problem && (
        <p id={`${id}-problem`} role="alert" className="text-sm text-error">
          <span className="font-semibold">{problem.title}.</span> {problem.detail}
        </p>
      )}
    </fieldset>
  );
}
