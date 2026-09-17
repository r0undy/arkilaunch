import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button } from './button.js';
import { describeUploadProblem, prepareUpload } from '../lib/image-compression.js';

// Both OCR intake screens used to render one file input carrying
// capture="environment". On most mobile browsers that attribute does not offer
// the camera alongside the file picker, it replaces the picker with the
// camera. So a timekeeper could not attach a photo already on the phone, and a
// KYC operator could not attach a PDF the endpoint plainly accepts.
//
// Two inputs, one with the attribute and one without, make the two intents
// separate and deliberate. This stays on the native file input (the restraint
// ladder's "native platform feature" rung) rather than reaching for a
// getUserMedia viewfinder: the OS camera is better on a cheap Android than
// anything we would build, and it costs no bundle.

export interface CaptureFieldProps {
  id: string;
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
  accept: string;
  /** 'field' matches the 48px timekeeper-console touch target (DESIGN.md §4). */
  size?: 'default' | 'field';
  disabled?: boolean;
}

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
}: CaptureFieldProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ title: string; detail: string } | null>(null);
  const [preparing, setPreparing] = useState(false);

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

  async function onPicked(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    // Reset both inputs so picking the same file twice still fires a change,
    // which is what "Retake" after a bad shot relies on.
    if (cameraRef.current) cameraRef.current.value = '';
    if (fileRef.current) fileRef.current.value = '';
    if (!picked) return;

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

  function clear() {
    setProblem(null);
    onChange(null);
  }

  const busy = preparing || disabled;

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0" aria-describedby={problem ? `${id}-problem` : undefined}>
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

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size={size}
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
        >
          {value ? 'Retake photo' : 'Take photo'}
        </Button>
        <Button variant="secondary" size={size} disabled={busy} onClick={() => fileRef.current?.click()}>
          Choose a file
        </Button>
        {value && (
          <Button variant="ghost" size={size} disabled={busy} onClick={clear}>
            Remove
          </Button>
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

      {value && preview && (
        <img src={preview} alt="The sheet you selected" className="max-h-48 w-fit rounded-sm border border-border" />
      )}

      {value && !preview && (
        <p className="text-sm text-text-muted">
          {value.name} ({formatBytes(value.size)}) ready to send.
        </p>
      )}
    </fieldset>
  );
}
