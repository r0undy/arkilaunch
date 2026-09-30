import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { onLuzonMainland, type CustomerSiteResponse, type SiteDocumentType } from '@arkilaunch/shared';
import { apiErrorText, apiPost } from '../lib/api-client.js';
import { reverseGeocode } from '../lib/reverse-geocode.js';
import { Modal } from './modal.js';
import { Alert } from './alert.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { SiteProofFields, uploadSiteDocument } from './site-proof.js';
import { PinMap } from './pin-map.js';

interface SiteDialogProps {
  open: boolean;
  onClose: () => void;
  customerId: string;
  onCreated?: (site: CustomerSiteResponse) => void;
}

// Mounted only while open, so closing resets every field.
export function SiteDialog(props: SiteDialogProps) {
  return props.open ? <SiteDialogBody {...props} /> : null;
}

function SiteDialogBody({ onClose, customerId, onCreated }: SiteDialogProps) {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [line1, setLine1] = useState('');
  const [barangay, setBarangay] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [proofType, setProofType] = useState<SiteDocumentType>('building_permit');
  const [proof, setProof] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  // Kept across a retry after a failed upload, so the site is never POSTed twice.
  const created = useRef<CustomerSiteResponse | null>(null);

  async function fillFromPin(lat: number, lng: number) {
    setLooking(true);
    const found = await reverseGeocode(lat, lng);
    setLooking(false);
    if (!found) return;
    if (found.street) setLine1(found.street);
    if (found.barangay) setBarangay(found.barangay);
    if (found.city) setCity(found.city);
    if (found.province) setProvince(found.province);
    if (found.postalCode) setPostalCode(found.postalCode);
  }
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  function placePin(lat: number, lng: number) {
    if (!onLuzonMainland(lat, lng)) { setLocateError('Choose a location on Luzon mainland.'); return; }
    setLocateError(null);
    setPin({ lat, lng });
    void fillFromPin(lat, lng);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocateError('This browser cannot share its location. Click the map instead.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        placePin(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocating(false);
        setLocateError('Location was not shared. Click the map to place the pin.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const create = useMutation({
    mutationFn: async () => {
      const site =
        created.current ??
        (await apiPost<CustomerSiteResponse>('/me/sites', {
          customerId,
          line1: line1.trim(),
          barangay: barangay.trim() || undefined,
          city: city.trim(),
          province: province.trim(),
          postalCode: postalCode.trim() || undefined,
          latitude: pin!.lat,
          longitude: pin!.lng,
        }));
      created.current = site;
      await uploadSiteDocument(site.id, proofType, proof!);
      await uploadSiteDocument(site.id, 'site_photo', photo!);
      return site;
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: ['me', 'sites'] }),
    onSuccess: async (site) => {
      await queryClient.invalidateQueries({ queryKey: ['me', 'sites'] });
      onCreated?.(site);
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pin && proof && photo) create.mutate();
  }

  return (
    <Modal open onClose={onClose} title="Add a project site" description="Where the machines are delivered." size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-site-form" variant="primary" loading={create.isPending} disabled={!pin || !proof || !photo}>
            Save site
          </Button>
        </>
      }
    >
      <form id="new-site-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <PinMap label="Site location" value={pin} onChange={(at) => placePin(at.lat, at.lng)} className="h-72" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-text-muted" aria-live="polite">
              {pin
                ? `Pinned at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}${looking ? '. Finding the address...' : ''}`
                : 'Click the map to place the pin. The address fills in from it.'}
            </p>
            <Button type="button" variant="secondary" loading={locating} onClick={useMyLocation}>
              Use my location
            </Button>
          </div>
          {locateError && <Alert type="error">{locateError}</Alert>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Street address" required maxLength={300} value={line1} onChange={(e) => setLine1(e.target.value)} />
          <Input label="Barangay" maxLength={120} value={barangay} onChange={(e) => setBarangay(e.target.value)} />
          <Input label="City / municipality" required maxLength={120} value={city} onChange={(e) => setCity(e.target.value)} />
          <Input label="Province" required maxLength={120} value={province} onChange={(e) => setProvince(e.target.value)} />
          <Input label="ZIP code" inputMode="numeric" pattern="\d{4}" maxLength={4} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
        </div>
        <SiteProofFields idPrefix="new-site" proofType={proofType} onProofTypeChange={setProofType} onProofFile={setProof} onPhotoFile={setPhoto} />
        {create.isError && <Alert type="error">{apiErrorText(create.error)}</Alert>}
      </form>
    </Modal>
  );
}
