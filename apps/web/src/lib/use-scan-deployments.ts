import { useQueries } from '@tanstack/react-query';
import type { RentalRef } from './reference-client.js';
import { referenceQueries } from './queries.js';
import { siteName } from './format.js';

const NONE: never[] = [];

// The four pick lists every capture screen needs, cached across screens, plus
// the one label rule they all name a rental by.
export function useScanDeployments(enabled = true) {
  const [equipment, rentals, customers, sites] = useQueries({
    queries: [
      { ...referenceQueries.equipment(), enabled },
      { ...referenceQueries.rentals(), enabled },
      { ...referenceQueries.customers(), enabled },
      { ...referenceQueries.projectSites(), enabled },
    ],
  });

  /** A rental named by who it is for and where, not by its id. */
  const rentalLabel = (rental: RentalRef): string => {
    const customer = customers.data?.find((c) => c.id === rental.customerId)?.companyName;
    const site = sites.data?.find((s) => s.id === rental.projectSiteId);
    const where = site ? siteName(site) : null;
    return [customer ?? 'Unnamed customer', where].filter(Boolean).join(' - ');
  };

  return {
    equipmentList: equipment.data ?? NONE,
    rentals: rentals.data ?? NONE,
    customers: customers.data ?? NONE,
    sites: sites.data ?? NONE,
    rentalLabel,
    error: equipment.error ?? rentals.error ?? customers.error ?? sites.error ?? null,
  };
}
