import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteProofFields } from './site-proof.js';

const prepareUpload = vi.hoisted(() => vi.fn());
vi.mock('../lib/image-compression.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/image-compression.js')>()),
  prepareUpload,
}));

describe('SiteProofFields', () => {
  it('hands on the compressed photo, not the raw pick', async () => {
    const prepared = new File(['small'], 'capture.jpg', { type: 'image/jpeg' });
    prepareUpload.mockResolvedValue(prepared);
    const onPhotoFile = vi.fn();
    render(
      <SiteProofFields idPrefix="t" proofType="building_permit" onProofTypeChange={() => {}} onProofFile={() => {}} onPhotoFile={onPhotoFile} />,
    );

    const photo = document.querySelector<HTMLInputElement>('#t-photo')!;
    await userEvent.upload(photo, new File(['big'], 'IMG_0001.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(onPhotoFile).toHaveBeenCalledWith(prepared));
  });
});
