export interface FormattedTimestamp {
  relative: string;
  absolute: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatRelativeTime(iso: string | null, now: Date = new Date()): FormattedTimestamp | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const diffMs = now.getTime() - then.getTime();
  const absolute = then.toLocaleString();

  if (diffMs < MINUTE_MS) return { relative: 'moments ago', absolute };
  if (diffMs < HOUR_MS) {
    const minutes = Math.floor(diffMs / MINUTE_MS);
    return { relative: `${minutes} minute${minutes === 1 ? '' : 's'} ago`, absolute };
  }
  if (diffMs < DAY_MS) {
    const hours = Math.floor(diffMs / HOUR_MS);
    return { relative: `${hours} hour${hours === 1 ? '' : 's'} ago`, absolute };
  }
  const days = Math.floor(diffMs / DAY_MS);
  return { relative: `${days} day${days === 1 ? '' : 's'} ago`, absolute };
}
