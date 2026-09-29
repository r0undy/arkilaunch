import { useMemo, useState } from 'react';
import type { RentalRef } from '../lib/reference-client.js';
import { formatStatus } from '../lib/format.js';
import { Button } from './button.js';
import { EmptyState } from './empty-state.js';
import { Input } from './input.js';
import { Surface } from './surface.js';
import { PAGE_SIZE, Pagination } from './pagination.js';


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
  const [offset, setOffset] = useState(0);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rentals;
    return rentals.filter((rental) =>
      `${rental.code} ${rentalLabel(rental)}`.toLowerCase().includes(needle),
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
        onChange={(e) => {
          setSearch(e.target.value);
          setOffset(0);
        }}
        placeholder="Client or site"
      />

      {matches.length === 0 ? (
        <p className="text-sm text-text-muted">No deployment matches "{search}".</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {matches.slice(offset, offset + PAGE_SIZE).map((rental) => (
              <li key={rental.id}>
                <Surface
                  radius="md"
                  elevation="sm"
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-text">{rentalLabel(rental)}</span>
                    <span className="text-sm text-text-muted">
                      <span className="font-mono">{rental.code}</span> ·{' '}
                      {formatStatus(rental.status)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {onCheckBillings && (
                      <Button
                        variant="secondary"
                        size="field"
                        onClick={() => onCheckBillings(rental)}
                      >
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
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            total={matches.length}
            onOffsetChange={setOffset}
            noun="deployments"
          />
        </>
      )}
    </div>
  );
}
