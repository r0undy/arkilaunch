import { useEffect, useState } from 'react';
import Cropper, { type Area, type MediaSize } from 'react-easy-crop';
import { Modal } from './modal.js';
import { Button } from './button.js';

// A PhilSys card is ID-1 size, 85.6 x 54 mm. Square is offered for a
// photo taken too close to fit the card's shape. Free is the default: it
// starts on the whole photo and its width and height are set separately,
// which suits an A4 certificate as well as a card.
export const ID_CARD_ASPECT = 85.6 / 54;
type Shape = 'free' | number;

// Cuts the chosen area out of the photo at full resolution, JPEG 0.95 like
// the viewfinder's own capture (capture-field.tsx).
async function cropToFile(src: string, area: Area, name: string): Promise<File> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(area.width);
  canvas.height = Math.round(area.height);
  canvas.getContext('2d')!.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob) throw new Error('Could not crop the photo');
  return new File([blob], name.replace(/\.\w+$/, '') + '-cropped.jpg', { type: 'image/jpeg' });
}

export function IdCropDialog({
  file,
  onCancel,
  onCropped,
}: {
  file: File;
  onCancel: () => void;
  onCropped: (file: File) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<Shape>('free');
  // Free crop: react-easy-crop has no draggable edges, so the frame's size
  // is two sliders, each a share of the photo as displayed.
  const [media, setMedia] = useState<MediaSize | null>(null);
  const [freeSize, setFreeSize] = useState({ width: 1, height: 1 });
  const free = aspect === 'free';
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function confirm() {
    if (!src || !area) return;
    setBusy(true);
    try {
      onCropped(await cropToFile(src, area, file.name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onCancel}
      dismissOnScrim={false}
      title="Crop your document"
      description="Drag, zoom and resize so the document fills the frame edge to edge."
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Skip cropping
          </Button>
          <Button variant="primary" loading={busy} disabled={!area} onClick={confirm}>
            Use this crop
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative h-[38vh] min-h-56 w-full sm:h-[55vh] overflow-hidden rounded-sm bg-black" data-testid="id-cropper">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              {...(free
                ? media
                  ? { cropSize: { width: media.width * freeSize.width, height: media.height * freeSize.height } }
                  : {}
                : { aspect })}
              onMediaLoaded={setMedia}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="Crop shape" className="flex gap-2">
            {[
              { label: 'Free', value: 'free' as Shape },
              { label: 'ID card', value: ID_CARD_ASPECT },
              { label: 'Square', value: 1 },
            ].map((option) => (
              <Button
                key={option.label}
                role="radio"
                aria-checked={aspect === option.value}
                variant={aspect === option.value ? 'primary' : 'secondary'}
                onClick={() => setAspect(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {free &&
            (['width', 'height'] as const).map((side) => (
              <label key={side} className="flex min-w-48 flex-1 items-center gap-2 text-sm text-text">
                {side === 'width' ? 'Width' : 'Height'}
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.01}
                  value={freeSize[side]}
                  onChange={(e) => setFreeSize({ ...freeSize, [side]: Number(e.target.value) })}
                  className="min-h-11 flex-1 accent-[var(--color-primary)]"
                />
              </label>
            ))}
          <label className="flex min-w-48 flex-1 items-center gap-2 text-sm text-text">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="min-h-11 flex-1 accent-[var(--color-primary)]"
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
