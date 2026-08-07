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
        <Button type="submit" loading={create.isPending} disabled={create.isPending || !equipmentTypeId}>
          Add rate card
        </Button>
      </form>
    </Surface>
  );
}

function RetireAction({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const retire = useMutation({
    mutationFn: () => apiDelete(`/rate-cards/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rate-cards'] }),
  });
  return (
    <Button variant="destructive" size="field" onClick={() => retire.mutate()} loading={retire.isPending}>
      Retire
    </Button>
  );
}

function SettingsPage() {
  const columns: TableColumn<RateCardRow>[] = [
    { header: 'Equipment type', cell: (row) => row.equipmentTypeId.slice(0, 8) },
    { header: 'Rate type', cell: (row) => row.rateType },
    { header: 'Rate (PHP)', cell: (row) => row.rateValue, align: 'right' },
    { header: 'Effective from', cell: (row) => new Date(row.effectiveFrom).toLocaleDateString() },
    { header: '', cell: (row) => <RetireAction id={row.id} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Settings</h1>
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
