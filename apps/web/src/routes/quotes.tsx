import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiErrorText, apiGet, apiPost, apiPut } from '../lib/api-client.js';
import { referenceQueries } from '../lib/queries.js';
import { formatDate, formatPeso, formatRateType } from '../lib/format.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';
import { PageHeader } from '../components/page-header.js';
import { useToast } from '../components/toast.js';
import {
  DieselPriceForm,
  RateCardForm,
  RetireAction,
  rateCardsListQuery,
  type BillingSettings,
  type PricingParametersRow,
  type RateCardRow,
} from './app.settings.js';
import { TollsEditor, TruckSettingsEditor, truckSettingsQuery } from './app.trucks.js';

// Standard pricing (docs/cr-arkilaunch-standard-pricing.md). One price setup
// for every client, registered or not: the admin sets the formula inputs
// here, grouped by the service they price. Every booking is quoted off
// them automatically; a quote only changes when the customer negotiates.

type ParamField = 'operatorHourlyPhp' | 'maintenanceHourlyPhp' | 'bufferPct' | 'fuelLPerHour' | 'fuelLPerKm' | 'transportPhpPerKm';

// The formula inputs one service uses, saved as a new pricing-parameters
// version carrying every other input unchanged.
function ParamsForm({
  title,
  fields,
}: {
  title: string;
  fields: Array<{ key: ParamField; label: string; hint?: string; percent?: boolean }>;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useQuery({ queryKey: ['pricing-parameters'], queryFn: () => apiGet<PricingParametersRow | null>('/pricing/parameters') });
  const [draft, setDraft] = useState<Partial<Record<ParamField, string>>>({});
  const value = (key: ParamField, percent?: boolean): string => {
    if (draft[key] !== undefined) return draft[key];
    const saved = params.data?.[key];
    if (saved == null) return '';
    return String(percent ? Number(saved) * 100 : Number(saved));
  };
  const save = useMutation({
    mutationFn: () => {
      const p = params.data;
      const num = (key: ParamField, percent = false) => {
        const v = Number(value(key, percent));
        return percent ? v / 100 : v;
      };
      return apiPost('/pricing/parameters', {
        region: p?.region ?? 'NCR',
        operatorHourlyPhp: num('operatorHourlyPhp'),
        maintenanceHourlyPhp: num('maintenanceHourlyPhp'),
        bufferPct: num('bufferPct', true),
        fuelLPerHour: num('fuelLPerHour'),
        fuelLPerKm: num('fuelLPerKm'),
        transportPhpPerKm: num('transportPhpPerKm'),
        // Keep the admin's own diesel price and its date as they are.
        ...(p?.dieselOverridePhp != null ? { dieselOverridePhp: Number(p.dieselOverridePhp), dieselOverrideDate: p.dieselOverrideDate ?? undefined } : {}),
      });
    },
    onSuccess: () => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ['pricing-parameters'] });
      toast.success('Pricing saved', 'New bookings are quoted with these values.');
    },
    onError: (e) => toast.error('Could not save pricing', apiErrorText(e)),
  });
  if (params.isPending) return null;
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label={title}>
      <h3 className="font-display text-base font-semibold text-text">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((field) => (
          <Input
            key={field.key}
            label={field.label}
            type="number"
            min="0"
            step="0.01"
            numeric
            {...(field.hint ? { hint: field.hint } : {})}
            value={value(field.key, field.percent)}
            onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
          />
        ))}
      </div>
      <div>
        <Button variant="primary" loading={save.isPending} disabled={Object.keys(draft).length === 0} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Surface>
  );
}

// The fixed mobilization and demobilization on every equipment rental
// quote. Staff cannot change them per quote, even in a negotiation.
function MobilizationForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: ['billing-settings'], queryFn: () => apiGet<BillingSettings>('/pricing/billing-settings') });
  const [draft, setDraft] = useState<{ mobilizationPhp?: string; demobilizationPhp?: string }>({});
  const save = useMutation({
    mutationFn: () =>
      apiPut('/pricing/billing-settings', {
        ...saved.data,
        mobilizationPhp: Number(draft.mobilizationPhp ?? saved.data?.mobilizationPhp),
        demobilizationPhp: Number(draft.demobilizationPhp ?? saved.data?.demobilizationPhp),
      }),
    onSuccess: () => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ['billing-settings'] });
      toast.success('Mobilization saved', 'New bookings are quoted with these fees.');
    },
    onError: (e) => toast.error('Could not save mobilization', apiErrorText(e)),
  });
  if (!saved.data) return null;
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="Mobilization and demobilization">
      <h3 className="font-display text-base font-semibold text-text">Mobilization and demobilization</h3>
      <p className="text-sm text-text-muted">Fixed fees on every equipment rental. Trucking has none.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Mobilization (PHP)"
          type="number"
          min="0"
          step="0.01"
          numeric
          hint="Delivery to site."
          value={draft.mobilizationPhp ?? String(saved.data.mobilizationPhp)}
          onChange={(e) => setDraft({ ...draft, mobilizationPhp: e.target.value })}
        />
        <Input
          label="Demobilization (PHP)"
          type="number"
          min="0"
          step="0.01"
          numeric
          hint="Pick-up at the end of the hire."
          value={draft.demobilizationPhp ?? String(saved.data.demobilizationPhp)}
          onChange={(e) => setDraft({ ...draft, demobilizationPhp: e.target.value })}
        />
      </div>
      <div>
        <Button variant="primary" loading={save.isPending} disabled={Object.keys(draft).length === 0} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Surface>
  );
}

function RateCards() {
  const [offset, setOffset] = useState(0);
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const typeName = (id: string): string => (equipmentTypes.data ?? []).find((type) => type.id === id)?.name ?? 'Unknown type';
  const columns: TableColumn<RateCardRow>[] = [
    { header: 'Equipment type', cell: (row) => (row.equipmentId ? `${typeName(row.equipmentTypeId)} (one unit)` : typeName(row.equipmentTypeId)) },
    { header: 'Charged', cell: (row) => formatRateType(row.rateType) },
    { header: 'Rate', cell: (row) => formatPeso(row.rateValue), align: 'right' },
    { header: 'In use since', cell: (row) => formatDate(row.effectiveFrom) },
    {
      header: '',
      align: 'right',
      cell: (row) => <RetireAction id={row.id} label={`${typeName(row.equipmentTypeId)} (${formatRateType(row.rateType).toLowerCase()})`} />,
    },
  ];
  return (
    <>
      <RateCardForm />
      <DataPanel
        title="Rate cards"
        options={rateCardsListQuery(PAGE_SIZE, offset)}
        emptyTitle="No rate cards yet"
        emptyDescription="Add a rate card above so bookings of that type are quoted automatically."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <div>
            <Table columns={columns} rows={data.items} rowKey={(row) => row.id} />
            <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="rate cards" />
          </div>
        )}
      />
    </>
  );
}

function TruckFees() {
  const settings = useQuery(truckSettingsQuery);
  if (settings.isError) return <p className="text-sm text-error">{apiErrorText(settings.error)}</p>;
  return settings.data ? <TruckSettingsEditor initial={settings.data} /> : null;
}

const sectionHeading = 'font-display text-lg font-semibold text-text';

function StandardPricingPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Pricing"
        title="Quotes"
        description="One standard price for every client. Bookings are quoted automatically; a quote changes only when the customer negotiates."
      />

      <section className="flex flex-col gap-4" aria-labelledby="rental-pricing">
        <h2 id="rental-pricing" className={sectionHeading}>Equipment rental</h2>
        <MobilizationForm />
        <ParamsForm
          title="Hourly costs added to rent"
          fields={[
            { key: 'operatorHourlyPhp', label: 'Operator (PHP per hour)' },
            { key: 'maintenanceHourlyPhp', label: 'Maintenance (PHP per hour)' },
            { key: 'fuelLPerHour', label: 'Fuel (litres per hour)', hint: 'Charged at the diesel price below.' },
            { key: 'bufferPct', label: 'Buffer (%)', hint: 'Added on top of each line.', percent: true },
          ]}
        />
        <RateCards />
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="truck-pricing">
        <h2 id="truck-pricing" className={sectionHeading}>Trucking</h2>
        <ParamsForm
          title="Distance costs"
          fields={[
            { key: 'transportPhpPerKm', label: 'Transport (PHP per km)' },
            { key: 'fuelLPerKm', label: 'Fuel (litres per km)', hint: 'Charged at the diesel price below.' },
          ]}
        />
        <TruckFees />
        <TollsEditor />
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="shared-pricing">
        <h2 id="shared-pricing" className={sectionHeading}>Both services</h2>
        <DieselPriceForm />
      </section>
    </div>
  );
}

export const quotesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/quotes',
  beforeLoad: requireRole('admin'),
  component: StandardPricingPage,
});
