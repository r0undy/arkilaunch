import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button } from './button.js';
import { describeUploadProblem, prepareUpload, type PrepareUploadOptions } from '../lib/image-compression.js';
import { analyzeDocument, loadDocumentScanner, steadyHold, straightenDocument, type ScanCorners } from '../lib/document-scanner.js';

// getUserMedia is missing on insecure origins and rejects without permission or a camera: always keep the file-input fallback.
// KYC enables local edge detection; field sheets keep the lightweight manual frame.

export interface CaptureFieldProps {
  id: string;
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
  accept: string;
  size?: 'default' | 'field';
  disabled?: boolean;
  tips?: { title: string; detail: string }[];
  sessionData?: { label: string; value: string }[];
  /** Omit for OCR/KYC: Azure DI depends on prepareUpload's defaults. */
  uploadOptions?: PrepareUploadOptions;
  scanner?: boolean;
  onAccepted?: ((file: File) => void) | undefined;
}

// TypeScript's DOM lib does not model torch.
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
  uploadOptions,
  scanner = false,
  onAccepted,
}: CaptureFieldProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<(corners?: ScanCorners) => void>(() => {});
  const takingRef = useRef(false);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const reviewIdRef = useRef(0);
  const lastCornersRef = useRef<ScanCorners | null>(null);
  const holdStartRef = useRef<number | null>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ title: string; detail: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [scanStatus, setScanStatus] = useState('Align the whole document inside the frame');
  const [outline, setOutline] = useState<ScanCorners | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 1, height: 1 });
  const [holdProgress, setHoldProgress] = useState(0);
  const [pending, setPending] = useState<File | null>(null);
  const [corrected, setCorrected] = useState<File | null>(null);
  const [corners, setCorners] = useState<ScanCorners | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewPreview, setReviewPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!pending || pending.type === 'application/pdf') { setReviewPreview(null); return; }
    const url = URL.createObjectURL(adjusting || !corrected ? pending : corrected);
    setReviewPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pending, corrected, adjusting]);

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

  // Camera only while nothing is captured: a live stream drains the battery.
  useEffect(() => {
    if (value || pending || disabled || cameraError !== null) return;
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
  }, [value, pending, disabled, cameraError, stopCamera]);

  useEffect(() => {
    if (!scanner || !live || value || pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    async function run() {
      try {
        setScanStatus('Starting automatic alignment. You can also use the shutter.');
        const cv = await loadDocumentScanner();
        if (cancelled) return;
        const tick = () => {
          if (cancelled || takingRef.current) return;
          const video = videoRef.current;
          if (video?.videoWidth && video.videoHeight) {
            const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            context!.drawImage(video, 0, 0, canvas.width, canvas.height);
            const found = analyzeDocument(cv, context!.getImageData(0, 0, canvas.width, canvas.height));
            setVideoSize({ width: video.videoWidth, height: video.videoHeight });
            setOutline(found?.corners.map(({ x, y }) => ({ x: x / scale, y: y / scale })) as ScanCorners | undefined ?? null);
            const now = performance.now();
            if (!found || found.quality !== 'ready') {
              holdStartRef.current = null;
              lastCornersRef.current = null;
              setHoldProgress(0);
              setScanStatus(found?.quality === 'dark' ? 'Move to brighter, even light' : found?.quality === 'glare' ? 'Tilt the document to reduce glare' : found?.quality === 'blurry' ? 'Hold the camera steady and focus' : 'Align the whole document inside the frame');
            } else {
              const hold = steadyHold(lastCornersRef.current, found.corners, holdStartRef.current, now, canvas.width, canvas.height);
              holdStartRef.current = hold.startedAt;
              setHoldProgress(hold.progress);
              setScanStatus(`Hold steady ${Math.max(0, Math.ceil((2000 - hold.progress * 2000) / 1000))}`);
              if (hold.ready) {
                takingRef.current = true;
                captureRef.current(found.corners.map(({ x, y }) => ({ x: x / scale, y: y / scale })) as ScanCorners);
                return;
              }
            }
            lastCornersRef.current = found?.corners ?? null;
          }
          timer = setTimeout(tick, 200);
        };
        tick();
      } catch {
        if (!cancelled) setScanStatus('Automatic alignment is unavailable. Use the shutter or choose a file.');
      }
    }
    void run();
    return () => { cancelled = true; if (timer) clearTimeout(timer); holdStartRef.current = null; lastCornersRef.current = null; };
  }, [scanner, live, value, pending]);

  async function beginReview(file: File, source?: HTMLCanvasElement, detected?: ScanCorners, autoAccept = false) {
    const reviewId = ++reviewIdRef.current;
    sourceRef.current = source ?? null;
    setCorners(detected ?? (source ? [
      { x: source.width * 0.06, y: source.height * 0.06 },
      { x: source.width * 0.94, y: source.height * 0.06 },
      { x: source.width * 0.94, y: source.height * 0.94 },
      { x: source.width * 0.06, y: source.height * 0.94 },
    ] : null));
    setPending(file);
    setCorrected(null);
    setAdjusting(false);
    setReviewing(autoAccept);
    if (source && detected) {
      try {
        const straightened = await straightenDocument(source, detected);
        if (reviewId !== reviewIdRef.current) return;
        setCorrected(straightened);
        if (autoAccept) await acceptReview(straightened);
      }
      catch {
        if (reviewId === reviewIdRef.current) {
          setReviewing(false);
          setScanStatus('Could not straighten this photo. Adjust it or use the original.');
        }
      }
    }
  }

  async function hand(picked: File) {
    setProblem(null);
    if (scanner) {
      setPreparing(true);
      if (picked.type === 'application/pdf') { await acceptReview(picked); setPreparing(false); return; }
      try {
        const bitmap = await createImageBitmap(picked, { imageOrientation: 'from-image' });
        try {
          const source = document.createElement('canvas');
          const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
          source.width = Math.round(bitmap.width * scale);
          source.height = Math.round(bitmap.height * scale);
          const context = source.getContext('2d');
          if (!context) throw new Error('Canvas unavailable');
          context.drawImage(bitmap, 0, 0, source.width, source.height);
          let detected: ScanCorners | undefined;
          let clear = false;
          try {
            const cv = await loadDocumentScanner();
            const sample = document.createElement('canvas');
            const sampleScale = Math.min(1, 640 / Math.max(source.width, source.height));
            sample.width = Math.round(source.width * sampleScale);
            sample.height = Math.round(source.height * sampleScale);
            const sampleContext = sample.getContext('2d', { willReadFrequently: true });
            sampleContext?.drawImage(source, 0, 0, sample.width, sample.height);
            const found = sampleContext && analyzeDocument(cv, sampleContext.getImageData(0, 0, sample.width, sample.height));
            if (found) {
              detected = found.corners.map(({ x, y }) => ({ x: x / sampleScale, y: y / sampleScale })) as ScanCorners;
              clear = found.quality === 'ready';
            }
          } catch { /* Manual correction stays available when vision fails. */ }
          await beginReview(picked, source, detected, clear);
        } finally { bitmap.close?.(); }
      } catch (error) {
        setProblem(describeUploadProblem(error));
      } finally { setPreparing(false); }
      return;
    }
    setPreparing(true);
    try {
      const prepared = await prepareUpload(picked, uploadOptions);
      onChange(prepared);
    } catch (err) {
      onChange(null);
      setProblem(describeUploadProblem(err));
    } finally {
      setPreparing(false);
    }
  }

  async function onPicked(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    // Reset so re-picking the same file still fires change (Retake).
    if (cameraRef.current) cameraRef.current.value = '';
    if (fileRef.current) fileRef.current.value = '';
    if (!picked) return;
    await hand(picked);
  }

  // Full sensor resolution; prepareUpload downscales afterwards.
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
    const file = new File([blob], `document-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await hand(file);
  }
  captureRef.current = (detected) => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    stopCamera();
    void new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95)).then((blob) => {
      if (blob) void beginReview(new File([blob], `document-${Date.now()}.jpg`, { type: 'image/jpeg' }), canvas, detected, true);
    });
  };

  async function acceptReview(file: File) {
    setReviewing(true);
    try {
      const prepared = await prepareUpload(file, uploadOptions);
      setPending(null); setCorrected(null); sourceRef.current = null;
      takingRef.current = false;
      onChange(prepared);
      onAccepted?.(prepared);
    } catch (error) { setProblem(describeUploadProblem(error)); }
    finally { setReviewing(false); }
  }

  async function applyCorners() {
    if (!sourceRef.current || !corners) return;
    setReviewing(true);
    try { setCorrected(await straightenDocument(sourceRef.current, corners)); setAdjusting(false); }
    catch { setProblem({ title: 'Could not straighten the photo', detail: 'Try again or use the original.' }); }
    finally { setReviewing(false); }
  }

  function cancelReview() {
    reviewIdRef.current++;
    setPending(null); setCorrected(null); setCorners(null); sourceRef.current = null;
    takingRef.current = false; setAdjusting(false); holdStartRef.current = null;
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

  const busy = preparing || reviewing || disabled;

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
          {pending ? (
            <div className="flex flex-col gap-3">
              {pending.type === 'application/pdf' ? (
                <p className="text-sm text-text-muted">{pending.name} ready to read.</p>
              ) : (
                <div className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-md bg-black" style={{ aspectRatio: sourceRef.current ? `${sourceRef.current.width} / ${sourceRef.current.height}` : undefined }}>
                  {reviewPreview && <img src={reviewPreview} alt={adjusting ? 'Adjust the document corners' : 'Document scan to review'} className="h-full w-full object-contain" />}
                  {adjusting && corners && sourceRef.current && corners.map((corner, index) => (
                    <button
                      key={index}
                      type="button"
                      aria-label={`Document corner ${index + 1}`}
                      className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-accent shadow-md"
                      style={{ left: `${corner.x / sourceRef.current!.width * 100}%`, top: `${corner.y / sourceRef.current!.height * 100}%` }}
                      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
                      onPointerMove={(event) => {
                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        const rect = event.currentTarget.parentElement!.getBoundingClientRect();
                        const next = [...corners] as ScanCorners;
                        next[index] = { x: Math.max(0, Math.min(sourceRef.current!.width, (event.clientX - rect.left) / rect.width * sourceRef.current!.width)), y: Math.max(0, Math.min(sourceRef.current!.height, (event.clientY - rect.top) / rect.height * sourceRef.current!.height)) };
                        setCorners(next);
                      }}
                      onKeyDown={(event) => {
                        const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key] as number[] | undefined;
                        if (!move) return;
                        event.preventDefault();
                        const next = [...corners] as ScanCorners;
                        next[index] = { x: Math.max(0, Math.min(sourceRef.current!.width, corner.x + move[0]! * 5)), y: Math.max(0, Math.min(sourceRef.current!.height, corner.y + move[1]! * 5)) };
                        setCorners(next);
                      }}
                    />
                  ))}
                </div>
              )}
              <p role="status" className="text-sm text-text-muted">{reviewing ? 'Preparing the scan automatically…' : adjusting ? 'Drag the four corners to the edges of the document, then apply them.' : corrected ? 'Check that the whole document is visible and the text is clear.' : 'No clear document edges were found. Adjust the corners or use the original photo.'}</p>
              <div className="flex flex-wrap gap-2">
                {adjusting ? (
                  <Button variant="primary" disabled={busy} onClick={() => void applyCorners()}>Apply corners</Button>
                ) : (
                  <Button variant="primary" disabled={busy} onClick={() => void acceptReview(corrected ?? pending)}>{pending.type === 'application/pdf' ? 'Use file' : corrected ? 'Use scan' : 'Use original photo'}</Button>
                )}
                {sourceRef.current && <Button variant="secondary" disabled={busy} onClick={() => setAdjusting(!adjusting)}>{adjusting ? 'Cancel adjustment' : 'Adjust corners'}</Button>}
                {corrected && !adjusting && <Button variant="ghost" disabled={busy} onClick={() => void acceptReview(pending)}>Use original</Button>}
                <Button variant="ghost" disabled={busy} onClick={cancelReview}>Retake</Button>
              </div>
            </div>
          ) : value ? (
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
                className="aspect-[3/4] w-full object-contain sm:aspect-[4/3]"
              />
              {scanner && outline && (
                <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${videoSize.width} ${videoSize.height}`} preserveAspectRatio="xMidYMid meet">
                  <polygon points={outline.map(({ x, y }) => `${x},${y}`).join(' ')} fill="none" stroke={holdProgress > 0 ? '#42d39a' : '#fbbf24'} strokeWidth={Math.max(3, videoSize.width / 180)} />
                </svg>
              )}
              <div aria-hidden className="pointer-events-none absolute inset-6">
                <span className="absolute left-0 top-0 h-10 w-10 border-l-2 border-t-2 border-accent" />
                <span className="absolute right-0 top-0 h-10 w-10 border-r-2 border-t-2 border-accent" />
                <span className="absolute bottom-0 left-0 h-10 w-10 border-b-2 border-l-2 border-accent" />
                <span className="absolute bottom-0 right-0 h-10 w-10 border-b-2 border-r-2 border-accent" />
              </div>
              <p role="status" className="absolute inset-x-0 bottom-20 text-center text-sm tracking-wide text-white">
                {scanner ? scanStatus : 'Align the sheet inside the frame'}
              </p>
              {scanner && <div role="progressbar" aria-label="Steady hold" aria-valuenow={Math.round(holdProgress * 100)} aria-valuemin={0} aria-valuemax={100} className="absolute inset-x-6 bottom-16 h-1 rounded-pill bg-white/40"><div className="h-full bg-accent" style={{ width: `${holdProgress * 100}%` }} /></div>}
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
                  disabled={busy || !live || takingRef.current}
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
