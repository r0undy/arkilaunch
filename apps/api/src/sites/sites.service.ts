import { Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { projectSites, weatherAlerts, withTenantTx } from '@arkilaunch/db';
import {
  severityMessage,
  WEATHER_STALE_AFTER_MINUTES,
  type RequestContext,
  type WeatherAdvisoryResponse,
  type WeatherObservation,
  type WeatherSeverity,
} from '@arkilaunch/shared';

@Injectable()
export class SitesService {
  // GET /api/v1/sites/:id/weather (SDD §4, PRD-F5). Serves the latest
  // weather_alerts row for the site -- jobs/src/weather-poll.ts writes one
  // every cycle, calm or not (T2: the alerts table doubles as the reading
  // cache), so `is_stale` can be computed even for a site that has never
  // crossed a threshold. Readable by any authenticated tenant member (T4):
  // this is site-safety information, and timekeepers are the ones
  // physically on site; RLS is the isolation boundary, same posture as
  // reference/*.
  async weather(ctx: RequestContext, siteId: string): Promise<WeatherAdvisoryResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [site] = await tx.select().from(projectSites).where(eq(projectSites.id, siteId)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });

      const [latest] = await tx
        .select()
        .from(weatherAlerts)
        .where(eq(weatherAlerts.projectSiteId, siteId))
        .orderBy(desc(weatherAlerts.effectiveAt))
        .limit(1);

      if (!latest) {
        // No poll has ever run for this site (ENABLE_WEATHER_POLL default
        // off, or the site was just created) -- nothing to serve yet.
        return {
          siteId,
          observed: { tempC: 0, windKph: 0, precipMm: 0, code: 0 },
          advisory: { severity: 'none', message: severityMessage('none') },
          isStale: true,
          polledAt: null,
        };
      }

      const observed: WeatherObservation =
        (latest.observed as WeatherObservation | null) ?? { tempC: 0, windKph: 0, precipMm: 0, code: 0 };
      const severity = latest.severity as WeatherSeverity;
      const ageMinutes = (Date.now() - latest.effectiveAt.getTime()) / 60_000;

      return {
        siteId,
        observed,
        advisory: { severity, message: severityMessage(severity) },
        isStale: latest.isStale || ageMinutes > WEATHER_STALE_AFTER_MINUTES,
        polledAt: latest.effectiveAt.toISOString(),
      };
    });
  }
}
