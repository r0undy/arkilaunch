import { lazy, Suspense, useMemo } from 'react';
import type { SiteHubResponse } from '@arkilaunch/shared';
import { onLuzonMainland } from '@arkilaunch/shared';
import { MapSkeleton } from './route-map.js';

const Canvas = lazy(() => import('./site-equipment-map-canvas.js'));

export function SiteEquipmentMap({ site, units }: { site: SiteHubResponse['site']; units: SiteHubResponse['units'] }) {
  const onSite = useMemo(() => units.filter((unit) => unit.onSite && !unit.returned), [units]);
  if (!onLuzonMainland(site.latitude, site.longitude)) return <p className="text-sm text-text-muted">This saved site is outside the Luzon mainland map.</p>;
  return <div className="relative h-64 overflow-hidden rounded-md border border-border">
    <Suspense fallback={<MapSkeleton />}><Canvas site={site} units={onSite} /></Suspense>
  </div>;
}
