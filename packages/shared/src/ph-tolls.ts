// Class 3 (large trucks and trailers, 3+ axles: every self-loader) toll
// fees on the Luzon expressways, entry to exit, VAT-inclusive. From the
// TRB-approved matrices effective February 2026, as published on
// expressway.ph and read 2026-09-25. A tenant loads them as editable toll
// rates; the admin corrects any fee when the TRB changes it. A fee applies
// in either direction between the two points.
// ponytail: mostly from each expressway's Manila-side entry; add pairs as
// the yard's routes need them (the admin can add any toll by hand).
export const PH_TOLLS_AS_OF = '2026-02-01';

export interface PhToll {
  expressway: string;
  entry: string;
  exit: string;
  feePhp: number;
}

const from = (expressway: string, entry: string, fees: Record<string, number>): PhToll[] =>
  Object.entries(fees).map(([exit, feePhp]) => ({ expressway, entry, exit, feePhp }));

export const PH_CLASS3_TOLLS: PhToll[] = [
  ...from('NLEX', 'Balintawak', {
    'Mindanao Ave.': 254, Karuhatan: 254, Valenzuela: 254, Meycauayan: 254, Marilao: 254,
    'Ciudad de Victoria': 288, Bocaue: 315, Tambubong: 330, Balagtas: 408, Tabang: 471,
    'Sta. Rita': 493, Pulilan: 605, 'San Simon': 797, 'San Fernando': 943, Mexico: 1059,
    Angeles: 1198, Dau: 1232, 'Sta. Ines': 1319, Mabalacat: 1319,
  }),
  ...from('SCTEX', 'Balintawak (via NLEX)', {
    'Clark South': 1352, 'Clark North': 1400, Dolores: 1430, 'Bamban/New Clark City': 1561,
    Porac: 1555, Concepcion: 1635, Floridablanca: 1824, 'Hacienda Luisita': 1912,
    Dinalupihan: 2193, 'Tipo/Subic': 2569,
  }),
  ...from('TPLEX', 'La Paz', {
    Victoria: 91, Gerona: 175, Paniqui: 237, Moncada: 396, Carmen: 492, Urdaneta: 648,
    Binalonan: 704, Pozorrubio: 810, Sison: 871, 'Rosario/Baguio': 933,
  }),
  ...from('SLEX', 'Magallanes', {
    Buendia: 218, 'C-5': 218, Amorsolo: 218, Bicutan: 218, Sucat: 252, Alabang: 356,
    Filinvest: 373, 'Susana Heights': 419, 'San Pedro': 440, MCX: 489, Southwoods: 493,
    Carmona: 513, Mamplasan: 548, 'Sta. Rosa': 580, 'ABI/Greenfield': 624, Cabuyao: 653,
    Silangan: 672, Calamba: 735,
  }),
  ...from('SLEX', 'Bicutan', { Calamba: 587 }),
  ...from('Skyway Stage 3', 'Buendia', { Quirino: 315, Nagtahan: 315, 'Quezon Ave.': 792, Balintawak: 792 }),
  ...from('Skyway Stage 3', 'Balintawak', { 'E. Rodriguez': 387, 'Quezon Ave.': 387, Nagtahan: 792, Quirino: 792 }),
  ...from('STAR', 'Sto. Tomas', {
    Tanauan: 40, Malvar: 87, Calamba: 102, 'Sto. Toribio': 145, Lipa: 179, Ibaan: 270, Batangas: 337,
  }),
  ...from('CALAX', 'Silang Interchange', {
    'Silang East': 52, 'Sta. Rosa/Tagaytay': 136, 'Laguna Blvd.': 153, Technopark: 199, Greenfield: 244,
  }),
  ...from('CALAX', 'Silang East', { 'Sta. Rosa/Tagaytay': 83, 'Laguna Blvd.': 100, Technopark: 146, Greenfield: 192 }),
  ...from('CALAX', 'Sta. Rosa/Tagaytay', { 'Laguna Blvd.': 43, Technopark: 89, Greenfield: 134 }),
  ...from('CALAX', 'Laguna Blvd.', { Technopark: 45, Greenfield: 91 }),
  ...from('CALAX', 'Technopark', { Greenfield: 45 }),
  ...from('CAVITEX', 'Parañaque', { 'Bacoor/Zapote': 117, 'Sucat Rd./Dr. A. Santos Ave.': 114, Kawit: 381 }),
  ...from('CAVITEX', 'Bacoor/Zapote', { 'Sucat Rd./Dr. A. Santos Ave.': 114, Kawit: 264 }),
  ...from('CAVITEX', 'Kawit', { 'Sucat Rd./Dr. A. Santos Ave.': 378 }),
  ...from('CAVITEX', 'Sucat Rd./Dr. A. Santos Ave.', { 'C5 Rd. Ext./C.P. Garcia': 114 }),
  ...from('NAIAX', 'Andrews Ave./Terminal 3', {
    'NAIA Terminal 1': 134, 'NAIA Terminal 2': 134, 'Entertainment City': 134, 'Macapagal Blvd.': 134, CAVITEX: 134,
  }),
  ...from('NAIAX', 'NAIA Terminal 1', { 'Entertainment City': 104, 'Macapagal Blvd.': 104, CAVITEX: 104 }),
  ...from('NAIAX', 'NAIA Terminal 2', { 'Entertainment City': 104, 'Macapagal Blvd.': 104, CAVITEX: 104 }),
];

// OSM road names (what the router reports) to the matrix's expressway names.
const EXPRESSWAYS: [RegExp, string][] = [
  [/north luzon expressway|\bnlex\b/i, 'NLEX'],
  [/subic.{0,3}clark.{0,3}tarlac|\bsctex\b/i, 'SCTEX'],
  [/tarlac.{0,3}pangasinan.{0,3}la union|\btplex\b/i, 'TPLEX'],
  [/skyway/i, 'Skyway Stage 3'],
  [/south luzon expressway|\bslex\b/i, 'SLEX'],
  [/southern tagalog arterial|\bstar tollway\b/i, 'STAR'],
  [/cavite.{0,3}laguna expressway|\bcalax\b/i, 'CALAX'],
  [/manila.{0,3}cavite expressway|\bcavitex\b|coastal road/i, 'CAVITEX'],
  [/naia expressway|\bnaiax\b/i, 'NAIAX'],
];
export const expresswayOf = (road: string): string | null => EXPRESSWAYS.find(([re]) => re.test(road))?.[1] ?? null;

interface RouteStep {
  name?: string;
  ref?: string;
  destinations?: string;
  exits?: string;
}

// A ramp's signed destinations minus bare route refs ("E1"), or null.
function signed(step: RouteStep): string | null {
  const text = [step.destinations, step.exits]
    .filter(Boolean)
    .join(', ')
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter((t) => t && !/^[A-Z]{1,3}\d+[A-Z]?$/.test(t))
    .join(', ');
  return text || null;
}

// Each expressway stretch of an OSRM route (steps=true), with the signs on
// the ramps on and off it. A ramp signed only with the same route ref (an
// interchange inside NLEX) does not end the stretch.
export function tollHintsFromSteps(steps: RouteStep[]): { expressway: string; entry: string | null; exit: string | null }[] {
  type Stretch = { expressway: string; entry: string | null; exit: string | null; ref: string };
  const hints: Stretch[] = [];
  let open = null as Stretch | null;
  let lastSign: string | null = null;
  for (const step of steps) {
    const road = expresswayOf(`${step.name ?? ''} ${step.ref ?? ''}`);
    if (road) {
      if (open?.expressway !== road) {
        open = { expressway: road, entry: lastSign, exit: null, ref: step.ref ?? '' };
        hints.push(open);
      }
      continue;
    }
    if (open && open.ref && `${step.destinations ?? ''} ${step.ref ?? ''}`.includes(open.ref) && !signed(step)) continue;
    if (open) {
      open.exit = signed(step) ?? (step.name || null);
      open = null;
    }
    lastSign = signed(step) ?? (step.name || lastSign);
  }
  return hints.map(({ expressway, entry, exit }) => ({ expressway, entry, exit }));
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// "Sta. Rosa/Tagaytay" is on a sign reading "Santa Rosa; Tagaytay City".
function signsAt(point: string, sign: string | null): boolean {
  if (!sign) return false;
  const on = letters(sign.replace(/\bsanta\b/gi, 'sta').replace(/\bsanto\b/gi, 'sto'));
  return point.split('/').some((alt) => {
    const p = letters(alt.replace(/\(.*\)/, ''));
    return p.length >= 3 && on.includes(p);
  });
}

interface TollRow {
  id: string;
  expressway: string | null;
  entryPoint: string | null;
  exitPoint: string | null;
}

// The loaded toll rows a route most likely pays: per expressway stretch,
// the entry-exit pair its ramp signs name, or the matrix's Manila-side
// entry to the signed exit. Only a suggestion the admin confirms.
// ponytail: matches sign text to plaza names; add plaza coordinates if the
// suggestions miss often.
export function suggestTolls(hints: { expressway: string; entry: string | null; exit: string | null }[], tolls: TollRow[]): string[] {
  const ids: string[] = [];
  for (const hint of hints) {
    const rows = tolls.filter((t) => t.expressway === hint.expressway && t.entryPoint && t.exitPoint);
    const ends = (t: TollRow, sign: string | null) => signsAt(t.entryPoint!, sign) || signsAt(t.exitPoint!, sign);
    const byExit = rows.filter((t) => ends(t, hint.exit));
    const pick = byExit.find((t) => ends(t, hint.entry)) ?? byExit.find((t) => t.entryPoint === rows[0]?.entryPoint);
    if (pick && !ids.includes(pick.id)) ids.push(pick.id);
  }
  return ids;
}
