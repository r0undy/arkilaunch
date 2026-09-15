import { createRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiDelete, apiGet, apiPost } from '../lib/api-client.js';
import { referenceQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';
import { PageHeader } from '../components/page-header.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { useToast } from '../components/toast.js';
import { formatDate, formatPeso, formatRateType } from '../lib/format.js';

interface RateCardRow {
  id: string;
  equipmentTypeId: string;
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

const rateCardsListQuery = {
  queryKey: ['rate-cards'] as const,
  queryFn: () => apiGet<RateCardListResponse>('/rate-cards?includeSuperseded=false'),
};

function RateCardForm() {
  const queryClient = useQueryClient();
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const [equipmentTypeId, setEquipmentTypeId] = useState('');
  const [rateType, setRateType] = useState<'hourly' | 'daily' | 'monthly'>('daily');
  const [rateValue, setRateValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiPost('/rate-cards', { equipmentTypeId, rateType, rateValue: Number(rateValue) }),
    onSuccess: () => {
      setRateValue('');
      queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
    },
    onError: () => setError('Could not create this rate card.'),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
      <h2 className="font-display text-base font-semibold text-text">Add a rate card</h2>
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-48">
          <Select
            label="Equipment type"
            id="rate-equipment-type"
            required
            value={equipmentTypeId}
            onChange={(e) => setEquipmentTypeId(e.target.value)}
          >
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
        <div className="w-36">
          <Select
            label="Rate type"
            id="rate-type"
            value={rateType}
            onChange={(e) => setRateType(e.target.value as typeof rateType)}
          >
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
        <Button
          type="submit"
          loading={create.isPending}
          disabled={create.isPending || !equipmentTypeId}
        >
          Add rate card
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
      toast.success('Rate card retired', `${label} will not be used for new quotes.`);
    },
    onError: () => toast.error('Could not retire that rate card', 'Nothing was changed.'),
  });
  return (
    <>
      <Button
        variant="destructive"
        size="field"
        onClick={() => setConfirming(true)}
        loading={retire.isPending}
      >
        Retire
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Retire this rate card?"
        tone="danger"
        confirmLabel="Retire it"
        pending={retire.isPending}
        body={
          <p>
            New quotes will stop using <strong>{label}</strong>. Quotes already priced against it
            keep the rate they were given.
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

function SettingsPage() {
  // The table showed a UUID stub where the form's own dropdown already had
  // the readable name; same source, now used in both places.
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const typeName = (id: string): string =>
    (equipmentTypes.data ?? []).find((type) => type.id === id)?.name ?? 'Unknown type';

  const columns: TableColumn<RateCardRow>[] = [
    { header: 'Equipment type', cell: (row) => typeName(row.equipmentTypeId) },
    { header: 'Charged', cell: (row) => formatRateType(row.rateType) },
    { header: 'Rate', cell: (row) => formatPeso(row.rateValue), align: 'right' },
    { header: 'In use since', cell: (row) => formatDate(row.effectiveFrom) },
    {
      header: '',
      align: 'right',
      cell: (row) => (
        <RetireAction
          id={row.id}
          label={`${typeName(row.equipmentTypeId)} (${formatRateType(row.rateType).toLowerCase()})`}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Administration"
        title="Rate cards"
        description="What each kind of machine is charged at, and from when."
      />
      <RateCardForm />
      <DataPanel
        title="Rate cards"
        options={rateCardsListQuery}
        emptyTitle="No rate cards yet"
        emptyDescription="Add a rate card above to make an equipment type quotable."
        isEmpty={(data) => data.total === 0}
        render={(data) => <Table columns={columns} rows={data.items} rowKey={(row) => row.id} />}
      />
    </div>
  );
}

// Admin-only: owner and timekeeper are denied per the PRD §5.2 auth boundary.
export const appSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/settings',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: SettingsPage,
});
