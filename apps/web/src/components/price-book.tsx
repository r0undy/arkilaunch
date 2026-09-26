import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SIZE_CLASSES, sizeClassLabel, type SizeClass } from '@arkilaunch/shared';
import { apiDelete, apiErrorText, apiGet, apiPost, apiPut } from '../lib/api-client.js';
import { referenceQueries } from '../lib/queries.js';
import { DataPanel } from './data-panel.js';
import { Table, type TableColumn } from './table.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { Surface } from './surface.js';
import { PAGE_SIZE, Pagination } from './pagination.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { useToast } from './toast.js';
import { formatDate, formatPeso, formatRateType } from '../lib/format.js';

// The fixed price book (CR pricebook-kyc-weather): one price per equipment
// type x size class, the same for every client and every prospect. Each new
// booking is quoted from it automatically; staff change a price for one
// customer only by revising that booking's quote in a negotiation.

interface RateCardRow {
  id: string;
  equipmentTypeId: string;
  equipmentId: string | null;
  sizeClass: SizeClass | null;
  rateType: 'hourly' | 'daily' | 'monthly';
  rateValue: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface RateCardListResponse {
  items: RateCardRow[];
  total: number;
}

const rateCardsListQuery = (limit: number, offset: number) => ({
  queryKey: ['rate-cards', limit, offset] as const,
  queryFn: () => apiGet<RateCardListResponse>(`/rate-cards?includeSuperseded=false&limit=${limit}&offset=${offset}`),
});

function RateCardForm() {
  const queryClient = useQueryClient();
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const [equipmentTypeId, setEquipmentTypeId] = useState('');
  const [sizeClass, setSizeClass] = useState<SizeClass | ''>('');
  const [rateType, setRateType] = useState<'hourly' | 'daily' | 'monthly'>('daily');
  const [rateValue, setRateValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const typeName = equipmentTypes.data?.find((type) => type.id === equipmentTypeId)?.name;

  const create = useMutation({
    mutationFn: () =>
      apiPost('/rate-cards', {
        equipmentTypeId,
        ...(sizeClass ? { sizeClass } : {}),
        rateType,
        rateValue: Number(rateValue),
      }),
    onSuccess: () => {
      setRateValue('');
      queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
    },
    onError: (e) => setError(apiErrorText(e) || 'Could not add this price.'),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
      <h2 className="font-display text-base font-semibold text-text">Add a price</h2>
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-48">
          <Select label="Equipment type" id="rate-equipment-type" required value={equipmentTypeId} onChange={(e) => setEquipmentTypeId(e.target.value)}>
            <option value="" disabled>
              Select...
            </option>
            {(equipmentTypes.data ?? []).map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-48">
          <Select label="Size class" id="rate-size-class" value={sizeClass} onChange={(e) => setSizeClass(e.target.value as SizeClass | '')}>
            <option value="">Every size</option>
            {SIZE_CLASSES.map((size) => (
              <option key={size} value={size}>
                {sizeClassLabel(size, typeName)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <Select label="Charged" id="rate-type" value={rateType} onChange={(e) => setRateType(e.target.value as typeof rateType)}>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="monthly">Monthly</option>
          </Select>
        </div>
        <div className="w-36">
          <Input
            label="Rate (PHP)"
            id="rate-value"
            type="number"
            min="0.01"
            step="0.01"
            required
            numeric
            value={rateValue}
            onChange={(e) => setRateValue(e.target.value)}
            {...(error ? { error } : {})}
          />
        </div>
        <Button type="submit" loading={create.isPending} disabled={create.isPending || !equipmentTypeId}>
          Add price
        </Button>
      </form>
    </Surface>
  );
}

function RetireAction({ id, label }: { id: string; label: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const retire = useMutation({
    mutationFn: () => apiDelete(`/rate-cards/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
      toast.success('Price retired', `${label} will not be used for new quotes.`);
    },
    onError: () => toast.error('Could not retire that price', 'Nothing was changed.'),
  });
  return (
    <>
      <Button variant="destructive" size="field" onClick={() => setConfirming(true)} loading={retire.isPending}>
        Retire
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Retire this price?"
        tone="danger"
        confirmLabel="Retire it"
        pending={retire.isPending}
        body={
          <p>
            New quotes will stop using <strong>{label}</strong>. Quotes already priced against it keep the rate they
            were given.
          </p>
        }
        onConfirm={() => {
          retire.mutate();
          setConfirming(false);
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

interface BillingSettings {
  mobilizationPhp: number;
  demobilizationPhp: number;
  [key: string]: number;
}

// Equipment rental only: trucking is priced per trip and has no
// mobilization or demobilization.
function TransportFeesForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: ['billing-settings'], queryFn: () => apiGet<BillingSettings>('/pricing/billing-settings') });
  const [draft, setDraft] = useState<BillingSettings | null>(null);
  const current = draft ?? saved.data;
  const save = useMutation({
    mutationFn: () => apiPut('/pricing/billing-settings', current),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['billing-settings'] });
      toast.success('Mobilization and demobilization saved');
    },
    onError: (e) => toast.error('Could not save the fees', apiErrorText(e)),
  });
  if (!current) return null;
  const edit = (patch: Partial<BillingSettings>) => setDraft({ ...current, ...patch } as BillingSettings);
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="Mobilization and demobilization">
      <h2 className="font-display text-base font-semibold text-text">Mobilization and demobilization (equipment rental)</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Mobilization (PHP)" type="number" min="0" step="0.01" numeric hint="Delivery to site, on every equipment rental quote." value={String(current.mobilizationPhp)} onChange={(e) => edit({ mobilizationPhp: Number(e.target.value) })} />
        <Input label="Demobilization (PHP)" type="number" min="0" step="0.01" numeric hint="Pick-up at the end of the hire." value={String(current.demobilizationPhp)} onChange={(e) => edit({ demobilizationPhp: Number(e.target.value) })} />
      </div>
      <div>
        <Button variant="primary" loading={save.isPending} disabled={!draft} onClick={() => save.mutate()}>
          Save fees
        </Button>
      </div>
    </Surface>
  );
}

export function PriceBook() {
  const [offset, setOffset] = useState(0);
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const typeName = (id: string): string => (equipmentTypes.data ?? []).find((type) => type.id === id)?.name ?? 'Unknown type';
  const rowLabel = (row: RateCardRow): string => {
    const name = typeName(row.equipmentTypeId);
    if (row.equipmentId) return `${name} (one unit)`;
    return row.sizeClass ? `${name}, ${sizeClassLabel(row.sizeClass, name)}` : `${name}, every size`;
  };

  const columns: TableColumn<RateCardRow>[] = [
    { header: 'Equipment', cell: rowLabel },
    { header: 'Charged', cell: (row) => formatRateType(row.rateType) },
    { header: 'Rate', cell: (row) => formatPeso(row.rateValue), align: 'right' },
    { header: 'In use since', cell: (row) => formatDate(row.effectiveFrom) },
    {
      header: '',
      align: 'right',
      cell: (row) => <RetireAction id={row.id} label={`${rowLabel(row)} (${formatRateType(row.rateType).toLowerCase()})`} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <TransportFeesForm />
      <RateCardForm />
      <DataPanel
        title="Equipment rental prices"
        options={rateCardsListQuery(PAGE_SIZE, offset)}
        emptyTitle="No prices yet"
        emptyDescription="Add a price above to make an equipment type quotable."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <div>
            <Table columns={columns} rows={data.items} rowKey={(row) => row.id} />
            <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="prices" />
          </div>
        )}
      />
      <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-4">
        <h2 className="font-display text-base font-semibold text-text">Trucking</h2>
        <p className="text-sm text-text-muted">
          Trucking is priced per trip from your truck rates and toll matrix, with no mobilization or demobilization.{' '}
          <Link to="/app/trucks" className="underline">
            Edit trucking rates
          </Link>
          .
        </p>
      </Surface>
    </div>
  );
}
