import { useEffect, useState } from 'react';
import type { EdtrDetailResponse } from '@arkilaunch/shared';
import { apiGet } from '../lib/api-client.js';
import { ConfidenceChip } from './confidence-chip.js';
import { Surface } from './surface.js';

// The "Review Document" view: the page the model actually read, with a box
// over each field it took a reading from, coloured by whether that reading
// cleared the 0.90 gate.
//
// The boxes are drawn only where a polygon exists. A field with no
// bounding region is still listed as a chip -- it is simply not pointed at.
// Inventing a position would tell a reviewer the model read a cell it did
// not, which is worse than showing nothing.

export interface ScanReviewProps {
  detail: EdtrDetailResponse;
}

interface Box {
  name: string;
  belowGate: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

// Polygons arrive normalised to 0..1 of the page (the Azure adapter scales
// them against the page's own width and height, since Azure reports inches
// for a PDF and pixels for an image). The axis-aligned bounds of the four
// points are what an HTML overlay can position; a rotated sheet gets a
// slightly loose box rather than a wrong one.
function toBox(field: EdtrDetailResponse['fields'][number]): Box | null {
  const polygon = field.boundingRegion?.polygon;
  if (!polygon || polygon.length < 8 || polygon.length % 2 !== 0) return null;
  const xs = polygon.filter((_, i) => i % 2 === 0);
  const ys = polygon.filter((_, i) => i % 2 === 1);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  if (!(width > 0 && height > 0)) return null;
  return { name: field.name, belowGate: field.belowGate, left, top, width, height };
}

export function ScanReview({ detail }: ScanReviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // Not an error surface: a missing scan image is a degraded review, not a
  // failed one, so the fields below still stand on their own.
  const [imageUnavailable, setImageUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImageUrl(null);
    setImageUnavailable(false);
    // Signed and short-lived (300s), re-fetched per review rather than
    // cached -- the scan is never a public URL (RFC-2 §6).
    apiGet<{ url: string }>(`/edtr/${detail.id}/image`)
      .then((res) => {
        if (!cancelled) setImageUrl(res.url);
      })
      .catch(() => {
        if (!cancelled) setImageUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  const boxes = detail.fields.map(toBox).filter((box): box is Box => box !== null);
  const needsReview = detail.fields.filter((field) => field.belowGate);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex-1">
        {imageUrl ? (
          <div className="relative w-full">
            <img
              src={imageUrl}
              alt="The scanned sheet, with the readings the model took marked on it"
              className="w-full rounded-sm border border-border"
            />
            {boxes.map((box) => (
              <span
                key={box.name}
                title={box.name}
                className={[
                  'pointer-events-none absolute border-2',
                  box.belowGate ? 'border-recon-review bg-recon-review/20' : 'border-recon-match',
                ].join(' ')}
                style={{
                  left: `${box.left * 100}%`,
                  top: `${box.top * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                }}
              />
            ))}
          </div>
        ) : imageUnavailable ? (
          <p className="text-sm text-text-muted">
            The scanned page could not be loaded, so only the readings below are shown.
          </p>
        ) : (
          <p className="text-sm text-text-muted">Loading the scanned page...</p>
        )}
        {boxes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 border-2 border-recon-match" /> Read confidently
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 border-2 border-recon-review bg-recon-review/20" /> Needs a
              look
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:w-80">
        <div className="flex flex-wrap gap-2">
          {detail.fields.map((field) => (
            <ConfidenceChip
              key={field.name}
              fieldLabel={field.name}
              confidence={field.confidence}
              tone={field.belowGate ? 'review' : 'match'}
            />
          ))}
        </div>

        {needsReview.length > 0 && (
          <Surface radius="md" elevation="sm" className="border-recon-review p-3">
            <p className="text-sm font-semibold text-text">Check these before approving</p>
            <ul className="mt-2 flex flex-col gap-2">
              {needsReview.map((field) => (
                <li key={field.name} className="text-sm">
                  <span className="font-medium text-text">{field.name}</span>{' '}
                  <span className="font-mono tabular-nums text-text">{String(field.value)}</span>
                  <span className="block text-text-muted">
                    Read at {(field.confidence * 100).toFixed(0)}% certainty, under the 90% needed
                    to accept it without a person.
                  </span>
                </li>
              ))}
            </ul>
            {/* A correction here is not an approval. Nothing on this screen
                deducts; the reading still goes through the same
                reconciliation gate (RFC-2 §3). */}
            <p className="mt-3 text-sm text-text-muted">
              Correcting a reading still leaves it to be matched against the second record of this
              machine-day before anything is billed.
            </p>
          </Surface>
        )}
      </div>
    </div>
  );
}
