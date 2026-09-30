import { createRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import type { ReactElement } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EquipmentResponse, MaintenanceWindowEndingSoon } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { equipmentQueries, type EquipmentListFilters } from '../lib/queries.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { Surface } from '../components/surface.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { EquipmentSchematic } from '../components/equipment-schematic.js';
import { Button, chipClass } from '../components/button.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { EquipmentFormModal } from '../components/equipment-form-modal.js';
import { MaintenanceModal } from '../components/maintenance-modal.js';
import { useToast } from '../components/toast.js';
import { Alert } from '../components/alert.js';
import { ActionMenu } from '../components/action-menu.js';
import { apiDelete, apiErrorText, apiGet, apiPatch } from '../lib/api-client.js';
import { getCurrentRole } from '../lib/guards.js';
import { Boxes, Check, Truck, Wrench } from 'lucide-react';

const STATUS_META: Record<string, { tone: StatusTone; label: string; icon: ReactElement }> = {
  available: { tone: 'fleet-available', label: 'Available', icon: <Check className="size-full" /> },
  deployed: { tone: 'fleet-deployed', label: 'Deployed', icon: <Truck className="size-full" /> },
  maintenance: { tone: 'fleet-maintenance', label: 'In maintenance', icon: <Wrench className="size-full" /> },
};

// The API orders by category, so a page splits into runs of one category.
function groupByCategory(items: EquipmentResponse[]): [string, EquipmentResponse[]][] {
  const groups = new Map<string, EquipmentResponse[]>();
  for (const item of items) {
    const key = item.equipmentTypeName ?? 'Uncategorised';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups];
}

function canManageFleet(): boolean {
  const role = getCurrentRole();
  return role === 'admin' || role === 'platform_admin';
}

function InventoryImage({ equipment, photo }: { equipment: EquipmentResponse; photo: string | undefined }) {
  const [failed, setFailed] = useState(false);
  return <div className="flex h-44 items-center justify-center overflow-hidden rounded-t-md bg-surface-sunk">
    {photo && !failed ? (
      <img src={photo} alt={`${equipment.model}, ${equipment.serialNo}`} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-cover" />
    ) : (
      <EquipmentSchematic typeName={equipment.equipmentTypeName ?? equipment.model} className="max-h-full p-6" />
    )}
  </div>;
}

// Retiring is the only way out of the fleet (DELETE is revoked) so billed field logs survive.
function EquipmentActions({ equipment, onEdit }: { equipment: EquipmentResponse; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const retire = useMutation({
    mutationFn: () => apiDelete(`/equipment/${equipment.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['equipment'] });
      toast.success('Equipment retired', `${equipment.model} has left the fleet list.`);
    },
    onError: (error) => toast.error('Could not retire that machine', apiErrorText(error)),
  });

  return (
    <>
      <ActionMenu
        label={`More actions for ${equipment.model}`}
        items={[
          { label: 'Edit details', onSelect: onEdit },
          { label: 'Retire equipment', onSelect: () => setConfirming(true), disabled: retire.isPending, destructive: true },
        ]}
      />
      <ConfirmDialog
        open={confirming}
        title="Retire this machine?"
        tone="danger"
        confirmLabel="Retire equipment"
        pending={retire.isPending}
        body={
          <div className="flex flex-col gap-2">
            <p>
              Retire <strong>{equipment.model}</strong> ({equipment.serialNo}) from the fleet? It
              stops appearing in the inventory, the catalog and anywhere a machine can be booked.
            </p>
            <p>Its rental history, field logs and invoices remain available as evidence.</p>
          </div>
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

function BlocksEndingSoon({ manageable }: { manageable: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const soon = useQuery({
    queryKey: ['maintenance-windows', 'ending-soon'],
    queryFn: () => apiGet<MaintenanceWindowEndingSoon[]>('/equipment/maintenance-windows/ending-soon'),
    refetchInterval: 10 * 60_000,
  });
  const extend = useMutation({
    mutationFn: (w: MaintenanceWindowEndingSoon) =>
      apiPatch(`/equipment/${w.equipmentId}/maintenance-windows/${w.windowId}`, {
        endsAt: new Date(new Date(w.endsAt).getTime() + 86_400_000).toISOString(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['maintenance-windows', 'ending-soon'] });
      void queryClient.invalidateQueries({ queryKey: ['equipment'] });
      toast.success('Block extended by a day');
    },
    onError: (e) => toast.error('Could not extend the block', apiErrorText(e)),
  });
  if (!soon.data || soon.data.length === 0) return null;
  return (
    <Alert type="info" header="Blocks ending soon">
      {soon.data.map((w) => {
        const hours = Math.max(0, Math.round((new Date(w.endsAt).getTime() - Date.now()) / 3_600_000));
        return (
          <div key={w.windowId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-text">
              <strong>{w.model}</strong> <span className="text-text-muted">({w.serialNo})</span> is free for booking again in{' '}
              {hours < 24 ? `${hours} h` : `${Math.ceil(hours / 24)} days`}
            </span>
            {manageable && (
              <Button variant="secondary" loading={extend.isPending && extend.variables?.windowId === w.windowId} onClick={() => extend.mutate(w)}>
                Extend +1 day
              </Button>
            )}
          </div>
        );
      })}
    </Alert>
  );
}

function FleetFilters({
  filters,
  categories,
  onChange,
}: {
  filters: EquipmentListFilters;
  categories: { equipmentTypeId: string; name: string; count: number }[];
  onChange: (next: EquipmentListFilters) => void;
}) {
  const all = categories.reduce((sum, c) => sum + c.count, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="Search"
          type="search"
          value={filters.q ?? ''}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Name, model number or serial"
        />
        <Select label="Status" value={filters.status ?? ''} onChange={(e) => onChange({ ...filters, status: e.target.value })}>
          <option value="">Any status</option>
          {Object.entries(STATUS_META).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </Select>
        <Select
          label="Needs attention"
          value={filters.missing ?? ''}
          onChange={(e) => onChange({ ...filters, missing: e.target.value as 'photo' | 'price' | '' })}
        >
          <option value="">Everything</option>
          <option value="photo">No photo</option>
          <option value="price">No price (no rate card)</option>
        </Select>
      </div>
      <div role="group" aria-label="Category" className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={!filters.typeId}
          className={chipClass(!filters.typeId)}
          onClick={() => onChange({ ...filters, typeId: '' })}
        >
          All ({all})
        </button>
        {categories.map((c) => (
          <button
            key={c.equipmentTypeId}
            type="button"
            aria-pressed={filters.typeId === c.equipmentTypeId}
            className={chipClass(filters.typeId === c.equipmentTypeId)}
            onClick={() => onChange({ ...filters, typeId: c.equipmentTypeId })}
          >
            {c.name} ({c.count})
          </button>
        ))}
      </div>
    </div>
  );
}

function InventoryPage() {
  const { q } = appInventoryRoute.useSearch();
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<EquipmentListFilters>(() => (q ? { q } : {}));
  const deferredFilters = useDeferredValue(filters);
  const listOptions = equipmentQueries.list(PAGE_SIZE, offset, deferredFilters);
  const categories = useQuery({ ...listOptions, placeholderData: keepPreviousData }).data?.categories ?? [];
  const [editing, setEditing] = useState<'create' | EquipmentResponse | null>(null);
  const [servicing, setServicing] = useState<EquipmentResponse | null>(null);
  const manageable = canManageFleet();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Equipment"
        description="Every machine in the fleet and where it stands."
        actions={
          manageable ? (
            <Button variant="primary" onClick={() => setEditing('create')}>
              Add equipment
            </Button>
          ) : null
        }
      />
      <BlocksEndingSoon manageable={manageable} />
      <FleetFilters
        filters={filters}
        categories={categories}
        onChange={(next) => {
          setFilters(next);
          setOffset(0);
        }}
      />
      <DataPanel
        title="Equipment"
        options={listOptions}
        emptyTitle={Object.values(filters).some(Boolean) ? 'No machines match these filters' : 'No equipment yet'}
        emptyDescription={
          Object.values(filters).some(Boolean)
            ? 'Clear a filter or pick another category.'
            : 'Add equipment to the fleet to see it listed here.'
        }
        emptyIcon={Boxes}
        isEmpty={(data) => data.items.length === 0}
        render={(data) => (
          <div className="flex flex-col gap-6">
            {groupByCategory(data.items).map(([category, units]) => (
            <section key={category} className="flex flex-col gap-3">
            <h2 className="text-heading-md text-text">
              {category} <span className="text-sm font-normal text-text-muted">({units.length} on this page)</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {units.map((eq) => {
                const meta = STATUS_META[eq.availabilityStatus] ?? STATUS_META['available']!;
                const photo = eq.photoUrl ?? equipmentImageUrl(eq.model);
                return (
                  <Surface
                    key={eq.id}
                    radius="md"
                    elevation="sm"
                    className="flex flex-col p-0 transition-shadow hover:shadow-md"
                    // Also lets the e2e spec scope actions to one machine by its serial.
                    role="group"
                    aria-label={eq.serialNo}
                  >
                    <InventoryImage equipment={eq} photo={photo} />
                    <div className="flex min-w-0 items-start justify-between gap-2 px-5 pt-4">
                      <div className="min-w-0">
                        <p className="text-heading-md text-text">{eq.model}</p>
                        <p className="font-mono text-xs tabular-nums text-text-muted">
                          {eq.serialNo}
                        </p>
                      </div>
                      <StatusPill tone={meta.tone} label={meta.label} icon={meta.icon} className="shrink-0" />
                    </div>
                    {manageable && (
                      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-5 py-4">
                        <Button variant="secondary" className="min-w-0 px-4" onClick={() => setServicing(eq)}>
                          Report &amp; maintenance
                        </Button>
                        <EquipmentActions equipment={eq} onEdit={() => setEditing(eq)} />
                      </div>
                    )}
                  </Surface>
                );
              })}
            </div>
            </section>
            ))}
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total}
              onOffsetChange={setOffset}
              noun="machines"
            />
          </div>
        )}
      />
      {editing && (
        <EquipmentFormModal
          {...(editing === 'create' ? {} : { equipment: editing })}
          onClose={() => setEditing(null)}
        />
      )}
      {servicing && (
        <MaintenanceModal equipment={servicing} onClose={() => setServicing(null)} />
      )}
    </div>
  );
}

export const appInventoryRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/inventory',
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search.q === 'string' && search.q.trim() ? { q: search.q.trim().slice(0, 100) } : {},
  component: InventoryPage,
});
