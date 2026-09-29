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
import { CheckIcon, TruckIcon, WrenchIcon } from '../components/icons.js';
import { Button, chipClass } from '../components/button.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { EquipmentFormModal } from '../components/equipment-form-modal.js';
import { MaintenanceModal } from '../components/maintenance-modal.js';
import { useToast } from '../components/toast.js';
import { Alert } from '../components/alert.js';
import { apiDelete, apiErrorText, apiGet, apiPatch } from '../lib/api-client.js';
import { getCurrentRole } from '../lib/guards.js';
import { Boxes } from 'lucide-react';

const STATUS_META: Record<string, { tone: StatusTone; label: string; icon: ReactElement }> = {
  available: { tone: 'fleet-available', label: 'Available', icon: <CheckIcon /> },
  deployed: { tone: 'fleet-deployed', label: 'Deployed', icon: <TruckIcon /> },
  maintenance: { tone: 'fleet-maintenance', label: 'In maintenance', icon: <WrenchIcon /> },
};

// fleet:manage is held by admin and platform_admin (seed/permission-catalog.ts;
// owner is deliberately excluded per QAD-T19). The route itself stays open so
// anyone who can read the fleet keeps the page they have today -- the API is
// the real boundary, this only decides whether to draw a button that would
// 403.
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

// Figma 293:3256 "Delete Asset?". The frame's body promises the action
// "will remove all associated maintenance and deployment logs" -- it does
// the opposite, and the copy here says so. Retiring is the only way a
// machine leaves the fleet (migration 0026 REVOKEs DELETE) precisely so the
// field logs an invoice was computed from survive.
function RetireAction({ equipment }: { equipment: EquipmentResponse }) {
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
      <Button variant="secondary" onClick={() => setConfirming(true)} loading={retire.isPending}>
        Delete
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Delete Asset?"
        tone="danger"
        confirmLabel="Delete asset"
        pending={retire.isPending}
        body={
          <div className="flex flex-col gap-2">
            <p>
              Remove <strong>{equipment.model}</strong> ({equipment.serialNo}) from the fleet? It
              stops appearing in the inventory, the catalog and anywhere a machine can be booked.
            </p>
            <p>
              Its rental history, field logs and the invoices they priced are kept. Deleting those
              would destroy the evidence those invoices were calculated from.
            </p>
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

// Blocked dates free the unit on their own once they end; this is the one
// cue before that happens, so an admin who needs longer extends in time.
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

// Category chips with counts, plus status, search and "still missing"
// filters. Changing any filter goes back to page one.
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
  // ?q= opens the list already searched: a maintenance notification names
  // its unit by serial (QA 26).
  const { q } = appInventoryRoute.useSearch();
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<EquipmentListFilters>(() => (q ? { q } : {}));
  // Typing in search refetches once the input settles, not per keystroke.
  const deferredFilters = useDeferredValue(filters);
  const listOptions = equipmentQueries.list(PAGE_SIZE, offset, deferredFilters);
  // The chips come from the same response; kept from the last load so they
  // do not flicker away while a new filter is fetching.
  const categories = useQuery({ ...listOptions, placeholderData: keepPreviousData }).data?.categories ?? [];
  // null = closed. 'create' = the add modal. An object = editing that unit.
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
                    className="flex flex-col overflow-hidden p-0 transition-shadow hover:shadow-md"
                    // Names the card for assistive tech, and lets the e2e
                    // spec scope actions to one machine by its serial.
                    role="group"
                    aria-label={eq.serialNo}
                  >
                    <div className="flex h-44 items-center justify-center overflow-hidden bg-surface-sunk">
                      {photo ? (
                        <img
                          src={photo}
                          alt={`${eq.model}, ${eq.serialNo}`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <EquipmentSchematic typeName={eq.equipmentTypeName ?? eq.model} className="max-h-full p-6" />
                      )}
                    </div>
                    <div className="flex items-start justify-between gap-2 px-5 pt-4">
                      <div className="min-w-0">
                        <p className="text-heading-md text-text">{eq.model}</p>
                        <p className="font-mono text-xs tabular-nums text-text-muted">
                          {eq.serialNo}
                        </p>
                      </div>
                      <StatusPill tone={meta.tone} label={meta.label} icon={meta.icon} />
                    </div>
                    {manageable && (
                      <div className="mt-auto flex flex-wrap gap-2 border-t border-border px-5 py-4">
                        <Button variant="secondary" onClick={() => setEditing(eq)}>
                          Edit
                        </Button>
                        <Button variant="secondary" onClick={() => setServicing(eq)}>
                          Report &amp; maintenance
                        </Button>
                        <RetireAction equipment={eq} />
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
