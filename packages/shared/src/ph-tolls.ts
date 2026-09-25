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
