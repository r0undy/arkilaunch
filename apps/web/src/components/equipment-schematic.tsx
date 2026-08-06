import type { ReactElement } from 'react';

// BRAND.md §3: flat two-colour (steel + amber) technical schematics where
// documentary photography is unavailable -- not soft rounded 3D blobs, not
// a stock photo. Keyed by equipment type name with a generic fallback.
// Accepts an optional real photo URL so documentary imagery can drop in
// later without touching layout.

export interface EquipmentSchematicProps {
  typeName: string;
  imageUrl?: string;
  className?: string;
}

const STROKE = 'var(--yb-color-border-strong, #9A917E)';
const ACCENT = 'var(--yb-color-primary, #F2A100)';

function Excavator() {
  return (
    <>
      <rect x="6" y="60" width="40" height="14" rx="2" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="16" cy="80" r="8" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="36" cy="80" r="8" fill="none" stroke={STROKE} strokeWidth="2" />
      <rect x="20" y="40" width="16" height="20" fill="none" stroke={STROKE} strokeWidth="2" />
      <path d="M32 44 L64 28 L74 40" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      <path d="M74 40 L84 58" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      <path d="M84 58 L78 66 L88 70" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
    </>
  );
}

function Bulldozer() {
  return (
    <>
      <rect x="8" y="55" width="70" height="6" fill="none" stroke={STROKE} strokeWidth="2" />
      <rect x="14" y="61" width="58" height="18" rx="2" fill="none" stroke={STROKE} strokeWidth="2" />
      <rect x="26" y="38" width="30" height="23" fill="none" stroke={STROKE} strokeWidth="2" />
      <path d="M2 76 L14 55 M2 76 L2 40 L14 40" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      <circle cx="26" cy="86" r="4" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="60" cy="86" r="4" fill="none" stroke={STROKE} strokeWidth="2" />
    </>
  );
}

function BoomLift() {
  return (
    <>
      <rect x="30" y="70" width="30" height="14" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="38" cy="88" r="6" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="52" cy="88" r="6" fill="none" stroke={STROKE} strokeWidth="2" />
      <path d="M45 70 L70 24" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      <rect x="66" y="12" width="14" height="16" fill="none" stroke={ACCENT} strokeWidth="2.5" />
    </>
  );
}

function WheelLoader() {
  return (
    <>
      <path d="M8 50 L18 32 L36 32 L40 46 L58 46" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      <path d="M40 46 L34 60 L48 60" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      <rect x="46" y="46" width="34" height="18" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="22" cy="70" r="9" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="62" cy="70" r="9" fill="none" stroke={STROKE} strokeWidth="2" />
    </>
  );
}

function DumpTruck() {
  return (
    <>
      <path d="M8 56 L20 34 L58 34 L58 56 Z" fill="none" stroke={STROKE} strokeWidth="2" />
      <rect x="58" y="42" width="24" height="14" fill="none" stroke={ACCENT} strokeWidth="2.5" />
      <circle cx="24" cy="70" r="7" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="66" cy="70" r="7" fill="none" stroke={STROKE} strokeWidth="2" />
    </>
  );
}

function RoadRoller() {
  return (
    <>
      <rect x="30" y="46" width="34" height="16" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="20" cy="74" r="14" fill="none" stroke={ACCENT} strokeWidth="3" />
      <circle cx="66" cy="74" r="10" fill="none" stroke={STROKE} strokeWidth="2" />
      <path d="M34 46 L34 30 L54 30 L54 46" fill="none" stroke={STROKE} strokeWidth="2" />
    </>
  );
}

function GeneratorSet() {
  return (
    <>
      <rect x="16" y="40" width="56" height="34" rx="3" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="44" cy="57" r="10" fill="none" stroke={ACCENT} strokeWidth="3" />
      <path d="M44 47 L44 67 M34 57 L54 57" stroke={ACCENT} strokeWidth="2" />
      <path d="M16 84 L72 84" stroke={STROKE} strokeWidth="2" />
    </>
  );
}

function BackhoeLoader() {
  return (
    <>
      <rect x="24" y="48" width="36" height="18" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="30" cy="76" r="8" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="54" cy="76" r="8" fill="none" stroke={STROKE} strokeWidth="2" />
      <path d="M60 50 L82 34 L90 44" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      <path d="M24 50 L10 40 L4 50" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
    </>
  );
}

function GenericUnit() {
  return (
    <>
      <rect x="14" y="34" width="60" height="30" rx="3" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="30" cy="74" r="8" fill="none" stroke={STROKE} strokeWidth="2" />
      <circle cx="58" cy="74" r="8" fill="none" stroke={STROKE} strokeWidth="2" />
      <path d="M14 44 L74 44" stroke={ACCENT} strokeWidth="2" />
    </>
  );
}

const SCHEMATICS: Record<string, () => ReactElement> = {
  Excavator: Excavator,
  Bulldozer: Bulldozer,
  'Boom Lift': BoomLift,
  'Wheel Loader': WheelLoader,
  'Dump Truck': DumpTruck,
  'Road Roller': RoadRoller,
  'Generator Set': GeneratorSet,
  'Backhoe Loader': BackhoeLoader,
};

export function EquipmentSchematic({ typeName, imageUrl, className = '' }: EquipmentSchematicProps) {
  if (imageUrl) {
    return <img src={imageUrl} alt={typeName} className={['h-full w-full object-cover', className].join(' ')} />;
  }
  const Glyph = SCHEMATICS[typeName] ?? GenericUnit;
  return (
    <svg
      viewBox="0 0 92 92"
      className={['h-full w-full', className].join(' ')}
      role="img"
      aria-label={`${typeName} schematic`}
    >
      <Glyph />
    </svg>
  );
}
