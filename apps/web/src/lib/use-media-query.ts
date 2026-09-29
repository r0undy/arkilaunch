import { useSyncExternalStore } from 'react';

// False without matchMedia (jsdom), so tests see the desktop layout.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
