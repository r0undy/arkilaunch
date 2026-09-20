import { useEffect, useMemo, useState } from 'react';
import {
  getCustomers,
  getEquipment,
  getProjectSites,
  getRentals,
  type CustomerRef,
  type EquipmentRef,
  type ProjectSiteRef,
  type RentalRef,
} from './reference-client.js';
import { siteName } from './format.js';

// The four pick lists every capture screen needs, plus the one label rule
// they all name a rental by. routes/edtr.tsx and routes/field.index.tsx had
// each written this out, with the same Promise.all and the same
// customer-plus-site label built two slightly different ways.
export function useScanDeployments(enabled = true) {
  const [equipmentList, setEquipmentList] = useState<EquipmentRef[]>([]);
  const [rentals, setRentals] = useState<RentalRef[]>([]);
  const [customers, setCustomers] = useState<CustomerRef[]>([]);
  const [sites, setSites] = useState<ProjectSiteRef[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.all([getEquipment(), getRentals(), getCustomers(), getProjectSites()])
      .then(([e, r, c, s]) => {
        if (cancelled) return;
        setEquipmentList(e);
        setRentals(r);
        setCustomers(c);
        setSites(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  /** A rental named by who it is for and where, not by its id. */
  const rentalLabel = useMemo(
    () =>
      (rental: RentalRef): string => {
        const customer = customers.find((c) => c.id === rental.customerId)?.companyName;
        const site = sites.find((s) => s.id === rental.projectSiteId);
        const where = site ? siteName(site) : null;
        return [customer ?? 'Unnamed customer', where].filter(Boolean).join(' - ');
      },
    [customers, sites],
  );

  return { equipmentList, rentals, customers, sites, rentalLabel, error };
}
