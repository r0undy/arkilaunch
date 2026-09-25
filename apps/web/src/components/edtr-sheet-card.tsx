import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EdtrSheetContext } from '@arkilaunch/shared';
import { apiErrorText, apiGet } from '../lib/api-client.js';
import { localDate } from './availability-days.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { useToast } from './toast.js';

function thisMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDate(d);
}

// EDTR v2 sheet for one unit and week, pre-printed from the booking, or the
// blank fallback. The renderer (and pdf-lib) load only on click.
export function EdtrSheetCard({ bookingId, printable }: { bookingId: string; printable: boolean }) {
  const toast = useToast();
  const context = useQuery({
    queryKey: ['booking', bookingId, 'edtr-sheet'],
    queryFn: () => apiGet<EdtrSheetContext>(`/bookings/${bookingId}/edtr-sheet`),
    enabled: printable,
  });
  const [equipmentId, setEquipmentId] = useState('');
  const [week, setWeek] = useState(thisMonday);
  const [busy, setBusy] = useState<string | null>(null);
  const units = context.data?.equipment ?? [];
  const unit = equipmentId || units[0]?.id || '';

  async function download(kind: 'pdf' | 'png', blank = false) {
    setBusy(`${blank ? 'blank-' : ''}${kind}`);
    try {
      const sheet = await import('../lib/edtr-sheet.js');
      // A picked date snaps to its week's Monday, so the sheet always covers Mon-Sun.
      const d = new Date(`${week}T00:00:00`);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const input = blank || !context.data ? {} : { context: context.data, equipmentId: unit, weekStart: localDate(d) };
      const png = await sheet.svgToPng(sheet.buildEdtrSheetSvg(input));
      sheet.downloadBlob(kind === 'png' ? png : await sheet.pngToPdf(png), sheet.edtrSheetFilename(input, kind));
    } catch (e) {
      toast.error('Could not build the sheet', apiErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
      <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">EDTR sheet</h2>
      {printable && units.length > 0 ? (
        <>
          <p className="text-sm text-text-muted">
            Pre-printed for one unit and one week (Mon to Sun), with a QR code. Print at 100% on A4 landscape.
          </p>
          {units.length > 1 && (
            <Select label="Unit" value={unit} onChange={(e) => setEquipmentId(e.target.value)}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.type} · {u.model} · SN {u.serialNo}
                </option>
              ))}
            </Select>
          )}
          <Input label="Week of" type="date" value={week} onChange={(e) => setWeek(e.target.value || thisMonday())} hint="Any day; the sheet covers its Monday to Sunday." />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === 'pdf'} onClick={() => void download('pdf')}>
              Download PDF
            </Button>
            <Button variant="secondary" loading={busy === 'png'} onClick={() => void download('png')}>
              Download PNG
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-text-muted">
          {printable && context.isPending ? 'Loading...' : 'A pre-printed sheet is available once a machine is assigned and the booking is paid.'}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
        <span className="text-text-muted">Blank sheet:</span>
        <Button variant="ghost" loading={busy === 'blank-pdf'} onClick={() => void download('pdf', true)}>
          PDF
        </Button>
        <Button variant="ghost" loading={busy === 'blank-png'} onClick={() => void download('png', true)}>
          PNG
        </Button>
      </div>
    </Surface>
  );
}
