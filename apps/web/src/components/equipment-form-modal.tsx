import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { EquipmentResponse } from '@arkilaunch/shared';
import { Modal } from './modal.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { Button } from './button.js';
import { CaptureField } from './capture-field.js';
import { useToast } from './toast.js';
import { apiErrorText, apiPatch, apiPost, apiPostForm } from '../lib/api-client.js';
import { referenceQueries } from '../lib/queries.js';

// Figma 292:1344 (Add Equipment) and 293:2668 (Edit Details). One component:
// the two frames are the same form, differing only in heading and submit
// label.
//
// Two sections of the frame are deliberately absent. HOURLY RATE and DAILY
// RATE would put a second price next to rate_cards, which is what quoting
// actually reads -- a competing source of truth on the money path -- so the
// form links to the rate cards screen instead. The frame's own section
// numbering (1, 2, 3, 5) is a design slip, not a missing section.

const FUEL_TYPES = ['Diesel', 'Gasoline', 'Electric', 'Hybrid', 'LPG'];

const STATUSES = [
  { value: 'available', label: 'Available' },
  { value: 'deployed', label: 'Deployed' },
  { value: 'maintenance', label: 'In maintenance' },
];

// The frame draws a textarea; the app has no Textarea primitive and one
// field does not earn a shared component. Mirrors Input's field styling.
const TEXTAREA_CLASSES =
  'block w-full rounded-sm border border-border bg-surface px-3.5 py-3 text-base text-text ' +
  'hover:border-border-strong focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

export interface EquipmentFormModalProps {
  /** Absent for create, present for edit. */
  equipment?: EquipmentResponse;
  onClose: () => void;
}

// An empty numeric field means "not specified", which must be omitted from
// the request rather than sent as 0 -- a machine with no recorded weight is
// not a machine that weighs nothing.
function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function textOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function EquipmentFormModal({ equipment, onClose }: EquipmentFormModalProps) {
  const isEdit = equipment !== undefined;
  const queryClient = useQueryClient();
  const toast = useToast();
  const types = useQuery(referenceQueries.equipmentTypes());

  const [equipmentTypeId, setEquipmentTypeId] = useState(equipment?.equipmentTypeId ?? '');
  const [model, setModel] = useState(equipment?.model ?? '');
  const [modelNumber, setModelNumber] = useState(equipment?.modelNumber ?? '');
  const [serialNo, setSerialNo] = useState(equipment?.serialNo ?? '');
  const [year, setYear] = useState(equipment?.yearOfManufacture?.toString() ?? '');
  const [tons, setTons] = useState(equipment?.weightCapacityTons?.toString() ?? '');
  const [engineType, setEngineType] = useState(equipment?.engineType ?? '');
  const [fuelType, setFuelType] = useState(equipment?.fuelType ?? '');
  const [status, setStatus] = useState(equipment?.availabilityStatus ?? 'available');
  const [notes, setNotes] = useState(equipment?.notes ?? '');
  const [categoryNote, setCategoryNote] = useState(equipment?.categoryNote ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [serialError, setSerialError] = useState<string | null>(null);

  // "Others" carries a free-text category instead of a standard one.
  const isOthers = types.data?.find((type) => type.id === equipmentTypeId)?.name === 'Others';

  const save = useMutation({
    mutationFn: async () => {
      const spec = {
        ...(textOrUndefined(modelNumber) ? { modelNumber: textOrUndefined(modelNumber) } : {}),
        ...(numberOrUndefined(year) !== undefined
          ? { yearOfManufacture: numberOrUndefined(year) }
          : {}),
        ...(numberOrUndefined(tons) !== undefined
          ? { weightCapacityTons: numberOrUndefined(tons) }
          : {}),
        ...(textOrUndefined(engineType) ? { engineType: textOrUndefined(engineType) } : {}),
        ...(textOrUndefined(fuelType) ? { fuelType: textOrUndefined(fuelType) } : {}),
        ...(textOrUndefined(notes) ? { notes: textOrUndefined(notes) } : {}),
        ...(isOthers && textOrUndefined(categoryNote)
          ? { categoryNote: textOrUndefined(categoryNote) }
          : {}),
      };

      // serialNo is absent from the edit request on purpose: migration 0026
      // REVOKEs UPDATE on that column, which is why the field is disabled.
      const saved = isEdit
        ? await apiPatch<EquipmentResponse>(`/equipment/${equipment.id}`, {
            model,
            availabilityStatus: status,
            ...spec,
          })
        : await apiPost<EquipmentResponse>('/equipment', {
            equipmentTypeId,
            model,
            serialNo,
            availabilityStatus: status,
            ...spec,
          });

      // The photo is a second request: it is multipart, and a failed upload
      // must not fail the save. Failing it left the modal open over a machine
      // that was already inserted, so the retry POSTed a duplicate.
      let photoError: string | null = null;
      if (photo) {
        try {
          await apiPostForm<EquipmentResponse>(`/equipment/${saved.id}/photo`, {}, photo);
        } catch (error) {
          photoError = apiErrorText(error);
        }
      }
      return { saved, photoError };
    },
    onSuccess: ({ saved, photoError }) => {
      void queryClient.invalidateQueries({ queryKey: ['equipment'] });
      if (photoError) {
        toast.error(
          `${saved.model} saved, but the photo did not upload`,
          `${photoError} Open Edit details to try the photo again.`,
        );
      } else {
        toast.success(
          isEdit ? 'Equipment updated' : 'Equipment added',
          `${saved.model} (${saved.serialNo}).`,
        );
      }
      onClose();
    },
    onError: (error) => {
      const text = apiErrorText(error);
      // A taken serial belongs beside the field that caused it, not in a
      // toast the reader has to map back to an input.
      if (text.toLowerCase().includes('serial')) {
        setSerialError('Another machine in the fleet already uses this serial number.');
        return;
      }
      toast.error(isEdit ? 'Could not save those changes' : 'Could not add that machine', text);
    },
  });

  const canSubmit =
    model.trim() !== '' &&
    (!isOthers || categoryNote.trim() !== '') &&
    (isEdit || (serialNo.trim() !== '' && equipmentTypeId));

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit details' : 'Add equipment'}
      description={
        isEdit ? equipment.serialNo : 'Record a machine so it can be deployed and rented.'
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Discard changes
          </Button>
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!canSubmit}
          >
            {isEdit ? 'Save changes' : 'Add equipment'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) save.mutate();
        }}
      >
        <section className="flex flex-col gap-4">
          <h3 className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            Basic information
          </h3>
          <Input
            label="Equipment name"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Caterpillar Heavy-Duty Excavator 320"
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Category"
              value={equipmentTypeId}
              onChange={(e) => setEquipmentTypeId(e.target.value)}
              disabled={isEdit}
              required={!isEdit}
              {...(isEdit
                ? { hint: 'A machine cannot change category after it is recorded.' }
                : {})}
            >
              <option value="">Choose a category</option>
              {(types.data ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
            <Input
              label="Model number"
              value={modelNumber}
              onChange={(e) => setModelNumber(e.target.value)}
              placeholder="CAT-320-GH"
            />
          </div>
          {isOthers && (
            <Input
              label="Describe the category"
              value={categoryNote}
              onChange={(e) => setCategoryNote(e.target.value)}
              placeholder="Asphalt paver"
              maxLength={200}
              required
            />
          )}
          <Input
            label="Serial / ID number"
            value={serialNo}
            onChange={(e) => {
              setSerialNo(e.target.value);
              setSerialError(null);
            }}
            disabled={isEdit}
            required={!isEdit}
            placeholder="SN-88291-XX-001"
            {...(serialError ? { error: serialError } : {})}
            {...(isEdit && !serialError
              ? { hint: 'A serial cannot be changed once field logs cite the machine.' }
              : {})}
          />
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            Technical specifications
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Year of manufacture"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2024"
            />
            <Input
              label="Weight / capacity (tons)"
              type="number"
              step="0.01"
              value={tons}
              onChange={(e) => setTons(e.target.value)}
              placeholder="22.5"
            />
            <Input
              label="Engine type"
              value={engineType}
              onChange={(e) => setEngineType(e.target.value)}
              placeholder="Diesel C7.1 ACERT"
            />
            <Select
              label="Fuel type"
              value={fuelType}
              onChange={(e) => setFuelType(e.target.value)}
            >
              <option value="">Not specified</option>
              {FUEL_TYPES.map((fuel) => (
                <option key={fuel} value={fuel}>
                  {fuel}
                </option>
              ))}
            </Select>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            Operational details
          </h3>
          <Select label="Current status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <p className="text-sm text-text-muted">
            Hire rates are not set here. Every machine of a category is priced by its{' '}
            <Link to="/app/settings" className="text-accent underline">
              rate card
            </Link>
            , which is what quotes are calculated from.
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            Notes
          </h3>
          <label htmlFor="equipment-notes" className="sr-only">
            Notes
          </label>
          <textarea
            id="equipment-notes"
            rows={4}
            className={TEXTAREA_CLASSES}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Technical notes, previous maintenance, or special handling instructions."
          />
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            Asset media
          </h3>
          <CaptureField
            id="equipment-photo"
            label="Equipment photo"
            value={photo}
            onChange={setPhoto}
            accept="image/*"
          />
        </section>
      </form>
    </Modal>
  );
}
