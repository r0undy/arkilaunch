import type { HTMLAttributes } from 'react';

export type SurfaceElevation = 'sm' | 'md' | 'lg';
export type SurfaceRadius = 'md' | 'lg';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: SurfaceElevation;
  radius?: SurfaceRadius;
}

const ELEVATION_CLASSES: Record<SurfaceElevation, string> = {
  sm: 'shadow-sm',
  md: 'shadow-md',
  lg: 'shadow-lg',
};

const RADIUS_CLASSES: Record<SurfaceRadius, string> = {
  md: 'rounded-md',
  lg: 'rounded-lg',
};

// DESIGN.md §4 Surfaces: border-first structure, --color-surface bg, no backdrop-filter.
export function Surface({ elevation = 'sm', radius = 'md', className = '', ...rest }: SurfaceProps) {
  return (
    <div
      className={['border border-border bg-surface', RADIUS_CLASSES[radius], ELEVATION_CLASSES[elevation], className].join(
        ' ',
      )}
      {...rest}
    />
  );
}
