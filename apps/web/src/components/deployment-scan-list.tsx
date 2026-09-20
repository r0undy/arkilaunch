import { useMemo, useState } from 'react';
import type { RentalRef } from '../lib/reference-client.js';
import { formatStatus, shortCode } from '../lib/format.js';
import { Button } from './button.js';
import { EmptyState } from './empty-state.js';
import { Input } from './input.js';
import { Surface } from './surface.js';

// "DTR scanning - select which deployment to manage": the list a scan is
// started from, so the sheet is attached to a known rental before the
// camera opens rather than picked out of a dropdown afterwards.
//
// A row is a rental, not the richer "deployment" the prototype draws. The
// operator, driver, contract length and contract value in that mock have no
// backing table -- rentals carry customer, site and dates, and nothing in
// the schema assigns a machine or a driver to one. Those columns are left
// out rather than filled with something that looks like data.
// See docs/cr-arkilaunch-viewfinder-capture.md.

export interface DeploymentScanListProps {
  rentals: RentalRef[];
  rentalLabel: (rental: RentalRef) => string;
  onScan: (rental: RentalRef) => void;
  onCheckBillings?: (rental: RentalRef) => void;
}

export function DeploymentScanList({
  rentals,
  rentalLabel,
  onScan,
  onCheckBillings,
}: DeploymentScanListProps) {
  const [search, setSearch] = useState('');

  // Filtering happens here rather than as a query parameter: the whole
  // pick list is already in memory, and a round trip per keystroke would
  // buy nothing.
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rentals;
    return rentals.filter((rental) =>
      `${rentalLabel(rental)} ${shortCode('rental', rental.id)}`.toLowerCase().includes(needle),
    );
  }, [rentals, rentalLabel, search]);

  if (rentals.length === 0) {
    return (
      <EmptyState
        title="Nothing is out on rental"
        description="A deployment appears here once a machine is out, and its daily sheets can be scanned against it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        id="deployment-search"
        label="Search deployments"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Client or site"
      />

      {matches.length === 0 ? (
        <p className="text-sm text-text-muted">No deployment matches "{search}".</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {matches.map((rental) => (
            <li key={rental.id}>
              <Surface
                radius="md"
                elevation="sm"
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-text">{rentalLabel(rental)}</span>
                  <span className="text-sm text-text-muted">
                    {formatStatus(rental.status)} - {shortCode('rental', rental.id)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {onCheckBillings && (
                    <Button variant="secondary" size="field" onClick={() => onCheckBillings(rental)}>
                      Check billings
                    </Button>
                  )}
                  <Button variant="primary" size="field" onClick={() => onScan(rental)}>
                    Scan DTR
                  </Button>
                </div>
              </Surface>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
