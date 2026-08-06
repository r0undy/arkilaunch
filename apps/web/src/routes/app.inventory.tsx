import { createRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { appLayoutRoute } from './_app.js';
import { equipmentQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { EquipmentSchematic } from '../components/equipment-schematic.js';
import { CheckIcon, TruckIcon, WrenchIcon } from '../components/icons.js';

const STATUS_META: Record<string, { tone: StatusTone; label: string; icon: ReactElement }> = {
  available: { tone: 'fleet-available', label: 'Available', icon: <CheckIcon /> },
  deployed: { tone: 'fleet-deployed', label: 'Deployed', icon: <TruckIcon /> },
  maintenance: { tone: 'fleet-maintenance', label: 'In maintenance', icon: <WrenchIcon /> },
};

function InventoryPage() {
  return (
    <DataPanel
      title="Equipment"
      options={equipmentQueries.list()}
      emptyTitle="No equipment yet"
      emptyDescription="Add equipment to the fleet to see it listed here."
      isEmpty={(data) => data.items.length === 0}
      render={(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader eyebrow="Fleet" title="Equipment" description={`${data.total} units in the fleet.`} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((eq) => {
              const meta = STATUS_META[eq.availabilityStatus] ?? STATUS_META['available']!;
              return (
                <Surface key={eq.id} radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
                  <div className="flex h-20 items-center justify-center rounded-sm bg-surface-sunk p-3">
                    <EquipmentSchematic typeName={eq.model} className="max-h-full" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-text">{eq.model}</p>
                      <p className="font-mono text-xs tabular-nums text-text-muted">{eq.serialNo}</p>
                    </div>
                    <StatusPill tone={meta.tone} label={meta.label} icon={meta.icon} />
                  </div>
                </Surface>
              );
            })}
          </div>
        </div>
      )}
    />
  );
}

export const appInventoryRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/inventory',
  component: InventoryPage,
});
