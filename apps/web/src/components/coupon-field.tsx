import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { CouponPreviewResponse } from '@arkilaunch/shared';
import { ApiError, apiErrorText, apiPost } from '../lib/api-client.js';
import { Button } from './button.js';
import { Input } from './input.js';

export function couponError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message === 'coupon_invalid') return 'That coupon code is not valid here.';
    if (err.message === 'coupon_used') return 'Your company has already used this coupon.';
    if (err.message === 'coupon_already_applied') return 'A coupon is already applied.';
  }
  return apiErrorText(err);
}

// The server says what a code takes off; nothing here computes money.
export function CouponField({
  previewPath,
  applied,
  onApplied,
}: {
  previewPath: string;
  applied: CouponPreviewResponse | null;
  onApplied: (coupon: CouponPreviewResponse | null) => void;
}) {
  const [code, setCode] = useState('');
  const preview = useMutation({
    mutationFn: (value: string) => apiPost<CouponPreviewResponse>(previewPath, { code: value }),
    onSuccess: (data) => onApplied(data),
  });

  if (applied) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-text">
          Coupon <span className="font-mono">{applied.code}</span> applied
        </span>
        <Button variant="ghost" onClick={() => onApplied(null)}>
          Remove
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim()) preview.mutate(code.trim().toUpperCase());
      }}
    >
      <div className="min-w-0 flex-1">
        <Input
          label="Coupon code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          error={preview.isError ? couponError(preview.error) : undefined}
        />
      </div>
      <Button type="submit" variant="secondary" loading={preview.isPending}>
        Apply
      </Button>
    </form>
  );
}
