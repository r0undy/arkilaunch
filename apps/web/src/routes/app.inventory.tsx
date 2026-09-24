import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EquipmentResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { equipmentQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { Surface } from '../components/surface.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { EquipmentSchematic } from '../components/equipment-schematic.js';
import { CheckIcon, TruckIcon, WrenchIcon } from '../components/icons.js';
import { Button } from '../components/button.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { EquipmentFormModal } from '../components/equipment-form-modal.js';
import { MaintenanceModal } from '../components/maintenance-modal.js';
import { useToast } from '../components/toast.js';
import { apiDelete, apiErrorText } from '../lib/api-client.js';
import { getCurrentRole } from '../lib/guards.js';

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
      <Button variant="destructive" onClick={() => setConfirming(true)} loading={retire.isPending}>
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

function InventoryPage() {
  const [offset, setOffset] = useState(0);
  // null = closed. 'create' = the add modal. An object = editing that unit.
  const [editing, setEditing] = useState<'create' | EquipmentResponse | null>(null);
  const [servicing, setServicing] = useState<EquipmentResponse | null>(null);
  const manageable = canManageFleet();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Fleet"
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
      <DataPanel
        title="Equipment"
        options={equipmentQueries.list(PAGE_SIZE, offset)}
        emptyTitle="No equipment yet"
        emptyDescription="Add equipment to the fleet to see it listed here."
        isEmpty={(data) => data.items.length === 0}
        render={(data) => (
          <div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((eq) => {
                const meta = STATUS_META[eq.availabilityStatus] ?? STATUS_META['available']!;
                return (
                  <Surface
                    key={eq.id}
                    radius="md"
                    elevation="sm"
                    className="flex flex-col gap-3 p-4"
                    // Names the card for assistive tech, and lets the e2e
                    // spec scope actions to one machine by its serial.
                    role="group"
                    aria-label={eq.serialNo}
                  >
                    <div className="flex h-20 items-center justify-center overflow-hidden rounded-sm bg-surface-sunk p-3">
                      {eq.photoUrl ? (
                        <img
                          src={eq.photoUrl}
                          alt={`${eq.model}, ${eq.serialNo}`}
                          className="max-h-full object-contain"
                        />
                      ) : (
                        <EquipmentSchematic typeName={eq.model} className="max-h-full" />
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text">{eq.model}</p>
                        <p className="font-mono text-xs tabular-nums text-text-muted">
                          {eq.serialNo}
                        </p>
                      </div>
                      <StatusPill tone={meta.tone} label={meta.label} icon={meta.icon} />
                    </div>
                    {manageable && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => setEditing(eq)}>
                          Edit
                        </Button>
                        <Button variant="secondary" onClick={() => setServicing(eq)}>
                          Maintenance
                        </Button>
                        <RetireAction equipment={eq} />
                      </div>
                    )}
                  </Surface>
                );
              })}
            </div>
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
  component: InventoryPage,
});
