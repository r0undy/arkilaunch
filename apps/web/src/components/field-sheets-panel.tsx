import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FIELD_SHEET_DAILY_LIMIT, type FieldSheetDownloadResponse, type FieldSheetUnit } from '@arkilaunch/shared';
import { ApiError, apiErrorText, apiPost } from '../lib/api-client.js';
import { edtrQueries, usersQueries } from '../lib/queries.js';
import { useTenant } from '../lib/tenant.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { useToast } from './toast.js';

export const LIMIT_REACHED = 'Limit reached, available again tomorrow.';

// This week's sheet for each unit at the timekeeper's sites; the server enforces the daily limit.
export function FieldSheetsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const sheets = useQuery(edtrQueries.fieldSheets());
  const me = useQuery(usersQueries.me());
  const tenant = useTenant();
  const [busy, setBusy] = useState<string | null>(null);

  async function download(unit: FieldSheetUnit) {
    setBusy(unit.equipmentId);
    try {
      const res = await apiPost<FieldSheetDownloadResponse>('/field/edtr-sheets', {
        rentalId: unit.rentalId,
        equipmentId: unit.equipmentId,
      });
      const sheet = await import('../lib/edtr-sheet.js');
      const input = {
        context: res.context,
        equipmentId: unit.equipmentId,
        weekStart: res.weekStart,
        page: res.page,
        companyName: me.data?.tenantName ?? '',
        logoDataUri: await sheet.logoDataUri(res.context.tenant?.logoUrl),
        accent: tenant?.primaryColor ?? null,
        tin: me.data?.tenantTin ?? null,
      };
      const png = await sheet.svgToPng(sheet.buildEdtrSheetSvg(input), res.page);
      sheet.downloadBlob(await sheet.pngToPdf(png, res.page), sheet.edtrSheetFilename(input, 'pdf'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) toast.error('Download limit', LIMIT_REACHED);
      else toast.error('Could not download the sheet', apiErrorText(e));
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: edtrQueries.fieldSheets().queryKey });
    }
  }

  const items = sheets.data?.items ?? [];
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-base font-semibold">Sheets for this week</h2>
        <p className="text-sm text-text-muted">
          Print this week&apos;s EDTR sheet for each unit. Each unit&apos;s sheet can be downloaded {FIELD_SHEET_DAILY_LIMIT} times a
          day.
        </p>
      </div>
      {sheets.isPending ? (
        <p className="text-sm text-text-muted">Loading...</p>
      ) : sheets.isError ? (
        <p className="text-sm text-text-muted">Could not load your sheets. {apiErrorText(sheets.error)}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-muted">No units are on your sites this week.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((unit) => (
            <li key={`${unit.rentalId}:${unit.equipmentId}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {unit.unitName} · SN {unit.serialNo}
                </p>
                <p className="text-xs text-text-muted">
                  {unit.siteName} · {unit.bookingCode} ·{' '}
                  {unit.remainingToday > 0 ? `${unit.remainingToday} of ${FIELD_SHEET_DAILY_LIMIT} left today` : LIMIT_REACHED}
                </p>
              </div>
              <Button
                variant="primary"
                loading={busy === unit.equipmentId}
                disabled={unit.remainingToday === 0 || (busy !== null && busy !== unit.equipmentId)}
                onClick={() => void download(unit)}
              >
                Download PDF
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
