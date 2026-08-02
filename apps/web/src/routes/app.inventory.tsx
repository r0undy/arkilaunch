import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { apiGet } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { Surface } from '../components/surface.js';
import { StatusPill } from '../components/status-pill.js';
import { CheckIcon, AlertIcon } from '../components/icons.js';
import type { EquipmentRef } from '../lib/reference-client.js';

function InventoryPage() {
  return (
    <DataPanel<EquipmentRef[]>
      title="Inventory"
      fetcher={() => apiGet<EquipmentRef[]>('/equipment')}
      emptyTitle="No equipment yet"
      emptyDescription="Add equipment to the fleet to see it listed here."
      isEmpty={(data) => data.length === 0}
      render={(data) => (
        <div className="flex flex-col gap-2">
          {data.map((eq) => (
            <Surface key={eq.id} radius="md" elevation="sm" className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-text">{eq.model}</p>
                <p className="text-xs text-text-muted">{eq.serialNo}</p>
              </div>
              <StatusPill
                tone={eq.availabilityStatus === 'available' ? 'recon-match' : 'recon-review'}
                label={eq.availabilityStatus}
                icon={eq.availabilityStatus === 'available' ? <CheckIcon /> : <AlertIcon />}
              />
            </Surface>
          ))}
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
