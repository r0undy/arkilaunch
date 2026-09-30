import { describe, expect, it } from 'vitest';
import type { DocumentText } from './document-intelligence-port.js';
import { parseCertificateDate, parseRegistrationCertificate, yearFromWords } from './kyc-certificate.js';

// Fixtures mirror real prebuilt-layout output, with every identifier replaced by a synthetic one.

type Row = [text: string, x0: number, y0: number, x1: number, y1: number];

// One line per row, positions in page pixels; `tilt` rotates the page by
// that many degrees, as a phone photo held off square would.
function page(rows: Row[], width: number, height: number, { tilt = 0, confidence = 0.99 } = {}): DocumentText {
  const rad = (tilt * Math.PI) / 180;
  const rotate = (x: number, y: number) => [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)];
  let offset = 0;
  const words: DocumentText['words'] = [];
  const lines: DocumentText['lines'] = [];
  for (const [text, x0, y0, x1, y1] of rows) {
    const polygon = [
      ...rotate(x0, y0),
      ...rotate(x1, y0),
      ...rotate(x1, y1),
      ...rotate(x0, y1),
    ].map((v, i) => (i % 2 === 0 ? v / width : v / height));
    lines.push({ offset, length: text.length, page: 1, polygon });
    for (const m of text.matchAll(/\S+/g)) words.push({ offset: offset + m.index, length: m[0].length, confidence });
    offset += text.length + 1;
  }
  return { content: rows.map((r) => r[0]).join('\n'), words, lines };
}

// SEC certificates parse from the text alone; positions do not matter.
const text = (paragraphs: string[], confidence = 0.99) => page(paragraphs.map((p, i) => [p, 0, i * 10, 100, i * 10 + 8]), 1000, 1000, { confidence });

const TODAY = new Date('2026-09-27T00:00:00Z');

const SEC_LEGACY = [
  'REPUBLIC OF THE PHILIPPINES SECURITIES AND EXCHANGE COMMISSION SEC Building, EDSA, Greenhills City of Mandaluyyong, Metro Manila',
  'COMPANY REG. NO. CS201912345 COMPANY TIN 123-456-789',
  'CERTIFICATE OF INCORPORATION',
  'KNOW ALL PERSONS BY THESE PRESENTS:',
  'This is to certify that the Articles of Incorporation and By-Laws of',
  'ALPHA BUILDERS INC. DOING BUSINESS UNDER THE NAME AND STYLE OF ALPHA HARDWARE',
  'SAMPLETONLY',
  'were duly approved by the Commission on this date upen the issuance of this Certificats of Incorporation in accordance with the Corporation Code of the Phi- lippines (Batas Pambansa Blg.68), and copies of suid Articles and By-Laws are hereto attached.',
  'IN WITNESS WHEREOF, I have hereunto set my hand and caused the seal of this Commission to be affixed at Mandaluyong City, Metro Manila, Philippines, this 5th day of March, Twenty Nineteen.',
  'JUAN B. SANTOS Director Company Registration and Monitoring Department',
];

const SEC_ESPARC = [
  'REPUBLIC OF THE PHILIPPINES SECURITIES AND EXCHANGE COMMISSION 3/F Newtown Square, Navy Base Road, Baguio City',
  'COMPANY REG. NO .: 2022090000001-02',
  'CERTIFICATE OF INCORPORATION',
  'This is to certify that the Articles of Incorporation and By Laws of:',
  'BENGUET HIGHLANDS FARMERS FEDERATED',
  'ASSOCIATION (BHFFA) INC.',
  'were duly approved by the Commission on this date upon the issuance of this Certificate of Incorporation in accordance with the Revised Corporation Code of the Philippines (Republic Act No. 11232), which took effect on February 23, 2019 and copies of said Articles of Incorporation and By Laws are hereto attached.',
  'IN WITNESS WHEREOF, I have hereunto set my hand and caused the seal of this Commission to be affixed to this Certificate at 3/F Newtown Square, Navy Base Road, Baguio City, Philippines, this day of 16 September Two Thousand Twenty Two.',
  'MARIA L. REYES Director',
  'For SEL me ouly 5941 (PSIC os rmerved) Non-stack Corporation Corporation with less than 5 Incorporators',
];

const SEC_DIGITAL = [
  'REPUBLIC OF THE PHILIPPINES SECURITIES AND EXCHANGE COMMISSION The SEC Headquarters 7907 Makati Avenue, Salcedo Village, Barangay Bel-Air, Makati City, 1209, Metro Manila',
  'COMPANY REG. NO .: 2024020000002-00',
  'CERTIFICATE OF INCORPORATION',
  'This is to certify that the Articles of Incorporation and By Laws of:',
  'GAMMA DIGITAL SOLUTIONS INC.',
  'were duly approved by the Commission on this date upon the issuance of this Certificate of Incorporation in accordance with the Revised Corporation Code of the Philippines (Republic Act No. 11232), which took effect on February 23, 2019 and copies of said Articles of Incorporation and By Laws are hereto attached.',
  'IN WITNESS WHEREOF, I have hereunto set my hand and caused the seal of this Commission to be affixed to this Certificate at The SEC Headquarters 7907 Makati Avenue, Salcedo Village, Barangay Bel- Air, Makati City, 1209, Metro Manila, Philippines, this day of 09 February Two Thousand Twenty Four.',
  'For SEC use only J582 (PSIC as reserved) Stock Corporation Less Than 5 Incorporators',
  'Note: The original copy of this Certificate must be secured within one year from the date of registration',
];

// BIR Form 2303, Revised July 1997 (860x1182 px scan).
const BIR_1997: Row[] = [
  ['2303', 105, 142, 173, 167],
  ['REPUBLIKA NG PILIPINAS KAGAWARAN NG PANANALAPI KAWANIHAN NG RENTAS INTERNAS', 301, 73, 543, 121],
  ['REVENUE DISTRICT NO. 110', 340, 141, 541, 154],
  ['BIR Form No. Revised July 1997', 41, 161, 145, 189],
  ['CERTIFICATE OF REGISTRATION', 271, 217, 559, 237],
  ['OGN', 624, 179, 656, 191],
  ['2RC0000123456', 668, 175, 801, 190],
  ['TIN', 40, 264, 64, 276],
  ['NAME', 246, 264, 290, 277],
  ['ALPHA BUILDERS INC.', 254, 288, 538, 305],
  ['REGISTRATION DATE', 588, 265, 733, 278],
  ['123-456-789-000', 73, 286, 225, 302],
  ['03/05/2019', 629, 293, 730, 308],
  ['REGISTERED ADDRESS', 39, 316, 195, 329],
  ['12 MABINI ST BRGY SAN ISIDRO', 215, 322, 467, 338],
  ['POBLACION', 214, 339, 335, 354],
  ['BUREAU OF INTERNAL REVENUE', 600, 340, 800, 352],
  ['GENERAL SANTOS CITY 9500', 214, 355, 416, 372],
  ['REGISTERED ACTIVITY(IES)', 39, 387, 225, 400],
  ['TAX TYPE', 71, 405, 153, 418],
  ['INCOME TAX', 72, 439, 172, 453],
  ['TRADE NAME', 70, 489, 171, 504],
  ['LINE OF BUSINESS / INDUSTRY', 423, 493, 697, 510],
  ['ALPHA HARDWARE', 69, 522, 353, 540],
  ['4659 WHOLESALE OF CONSTRUCTION MATERIALS', 415, 527, 747, 545],
  ['REMINDERS', 70, 694, 132, 705],
  ['Apply for the Authority to Print Receipts/Invoices within 30 days from date of registration.', 105, 752, 519, 770],
  ['09123456', 85, 902, 192, 921],
  ['VENERANDO B. CRUZ', 388, 949, 569, 965],
  ['DEC 1 1 2013', 601, 946, 729, 973],
];

// BIR Form 2303, Revised April 2019 (540x960 px photo), a sole proprietor.
function bir2019({ name = 'DELA CRUZ, JUAN SANTOS', type = ['MIXED INCOME EARNER - COMPENSATION INCOME EARNER AND SINGLE', 'PROPRIETOR'], trade = 'JDC HAULING SERVICES', tin = '123-456-789-00000' } = {}): Row[] {
  return [
    ['BIR FORM', 5, 131, 53, 141],
    ['2303', 5, 142, 69, 166],
    ['REVISED: APRIL 2019', 5, 168, 103, 179],
    ['REPUBLIKA NG PILIPINAS KAGAWARAN NG PANANALAPI KAWANIHAN NG RENTAS INTERNAS', 184, 149, 351, 183],
    ['REVENUE DISTRICT OFFICE NO. 54B /KAWIT, WEST CAVITE', 129, 192, 408, 205],
    ['OCN: 54BRC20240000001234', 381, 216, 511, 228],
    ['Date OCN Generated: June 11, 2024', 352, 227, 512, 238],
    ['CERTIFICATE OF REGISTRATION', 162, 261, 403, 277],
    ['TIN & BRANCH CODE', 21, 305, 121, 316],
    [tin, 32, 315, 119, 325],
    ['NAME OF TAXPAYER', 174, 306, 272, 317],
    [name, 180, 317, 370, 326],
    ['TIN ISSUANCE DATE', 381, 307, 475, 318],
    ['January 5, 2015', 386, 317, 485, 328],
    ['REGISTERING OFFICE', 20, 328, 125, 339],
    ['x', 174, 330, 182, 338],
    ['Head Office', 196, 330, 248, 340],
    ['Branch', 342, 331, 374, 341],
    ['REGISTERED ADDRESS', 20, 340, 132, 352],
    ['45 RIZAL AVE BRGY TABON I KAWIT CAVITE 4104', 193, 355, 420, 369],
    ['TAX TYPES', 48, 395, 102, 406],
    ['FILING', 204, 397, 236, 407],
    ['START DATE', 191, 408, 251, 419],
    ['INDIVIDUAL INCOME', 24, 473, 120, 484],
    ['1701Q', 145, 480, 174, 490],
    ['June 11,2024', 190, 480, 251, 491],
    ['QUARTERLY', 280, 480, 338, 491],
    ['TAXPAYER TYPE/S', 17, 532, 108, 542],
    ...type.map((t, i): Row => [t, 139, 531 + i * 11, 139 + t.length * 5.6, 543 + i * 11]),
    ['BUSINESS INFORMATION DETAILS', 16, 566, 183, 577],
    ['CATEGORY', 318, 579, 373, 590],
    ['TRADE NAME 1', 23, 592, 97, 603],
    ...(trade ? [[trade, 155, 592, 290, 601] as Row] : []),
    ['(PSIC)', 45, 606, 76, 617],
    ['4923 FREIGHT TRANSPORT BY ROAD', 126, 611, 273, 621],
    ['Line of Business', 20, 619, 99, 630],
    ['REGISTRATION DATE', 400, 580, 503, 592],
    ['August 1, 2024', 393, 592, 470, 602],
    ['Primary', 329, 613, 363, 624],
    ['REMINDERS', 14, 644, 75, 654],
    ['1 ... An annual registration fee shall be paid upon registration and every year thereafter on or before the last day', 32, 654, 515, 668],
    ['of January, using BIR Form No. 0605.', 49, 666, 212, 677],
  ];
}

const values = (fields: ReturnType<typeof parseRegistrationCertificate>['fields']) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value]));

describe('parseCertificateDate', () => {
  it.each([
    ['11/25/2013', '2013-11-25'],
    ['03/05/2019', '2019-03-05'],
    ['June 11, 2024', '2024-06-11'],
    ['June 11,2024', '2024-06-11'],
    ['16 September 2022', '2022-09-16'],
    ['2024-02-09', '2024-02-09'],
    ['24th day of April, Twenty Twenty Three', '2023-04-24'],
    ['day of 16 September Two Thousand Twenty Two', '2022-09-16'],
    ['day of 09 February Two Thousand Twenty Four', '2024-02-09'],
    ['1st day of July, Nineteen Ninety Eight', '1998-07-01'],
    ['day of 3 March Two Thousand and Ten', '2010-03-03'],
  ])('%s -> %s', (raw, iso) => expect(parseCertificateDate(raw, TODAY)).toBe(iso));

  it.each([['02/30/2020'], ['June 2024'], ['13/13/2020'], ['January 1, 1920'], ['January 1, 2031'], ['DEC 31'], ['Primary']])(
    'rejects %s',
    (raw) => expect(parseCertificateDate(raw, TODAY)).toBeNull(),
  );

  it('reads written-out years in both forms the SEC prints', () => {
    expect(yearFromWords('Twenty Twenty Three.')).toBe(2023);
    expect(yearFromWords('Two Thousand Twenty Two')).toBe(2022);
    expect(yearFromWords('Twenty Nineteen')).toBe(2019);
    expect(yearFromWords('Nineteen Hundred Ninety Eight')).toBe(1998);
    expect(yearFromWords('Director')).toBeNull();
  });
});

describe('parseRegistrationCertificate: SEC Certificate of Incorporation', () => {
  it('reads the pre-eSPARC certificate, and not its trade name, TIN or watermark', () => {
    const r = parseRegistrationCertificate('sec_certificate', text(SEC_LEGACY), TODAY);
    expect(r.layout).toBe('sec_coi');
    expect(values(r.fields)).toEqual({
      company_name: 'ALPHA BUILDERS INC.',
      sec_number: 'CS201912345',
      registration_date: '2019-03-05',
    });
  });

  it('reads the eSPARC certificate: a name on two lines, and the witness date, not the RA 11232 one', () => {
    const r = parseRegistrationCertificate('sec_certificate', text(SEC_ESPARC), TODAY);
    expect(values(r.fields)).toEqual({
      company_name: 'BENGUET HIGHLANDS FARMERS FEDERATED ASSOCIATION (BHFFA) INC.',
      sec_number: '2022090000001-02',
      registration_date: '2022-09-16',
    });
  });

  it('reads the digital certificate and never offers an address (the SEC prints only its own)', () => {
    const r = parseRegistrationCertificate('sec_certificate', text(SEC_DIGITAL), TODAY);
    expect(values(r.fields)).toEqual({
      company_name: 'GAMMA DIGITAL SOLUTIONS INC.',
      sec_number: '2024020000002-00',
      registration_date: '2024-02-09',
    });
    expect(r.fields.registered_address).toBeUndefined();
    expect(r.fields.tin).toBeUndefined();
  });

  it('joins a reg no. the OCR split with spaces', () => {
    const spaced = SEC_LEGACY.map((l) => l.replace('CS201912345', 'CS 2019 12345'));
    expect(parseRegistrationCertificate('sec_certificate', text(spaced), TODAY).fields.sec_number?.value).toBe('CS201912345');
    const dashed = SEC_ESPARC.map((l) => l.replace('2022090000001-02', '2022090000001 - 02'));
    expect(parseRegistrationCertificate('sec_certificate', text(dashed), TODAY).fields.sec_number?.value).toBe('2022090000001-02');
  });

  it('grades each value by its weakest OCR word', () => {
    const r = parseRegistrationCertificate('sec_certificate', text(SEC_DIGITAL, 0.8), TODAY);
    expect(r.fields.sec_number?.confidence).toBe(0.8);
  });

  it('does not recognise a BIR 2303 uploaded as the SEC certificate', () => {
    expect(parseRegistrationCertificate('sec_certificate', page(BIR_1997, 860, 1182), TODAY)).toEqual({ layout: null, fields: {} });
  });
});

describe('parseRegistrationCertificate: BIR Form 2303', () => {
  it('reads the 1997 form by position, skipping the OCN, doc-stamp no., stamp date and watermark', () => {
    const r = parseRegistrationCertificate('bir_cor', page(BIR_1997, 860, 1182), TODAY);
    expect(r.layout).toBe('bir_2303');
    expect(values(r.fields)).toEqual({
      tin: '123-456-789-000',
      company_name: 'ALPHA BUILDERS INC.',
      registered_address: '12 MABINI ST BRGY SAN ISIDRO, POBLACION, GENERAL SANTOS CITY 9500',
      registration_date: '2019-03-05',
    });
  });

  it('still reads it off a photo held a few degrees off square', () => {
    const r = parseRegistrationCertificate('bir_cor', page(BIR_1997, 860, 1182, { tilt: 2 }), TODAY);
    expect(values(r.fields)).toMatchObject({ tin: '123-456-789-000', registration_date: '2019-03-05', company_name: 'ALPHA BUILDERS INC.' });
  });

  it('reads the 2019 form: 5-digit branch, business registration date (not TIN issuance or filing dates), trade name for a sole proprietor', () => {
    const r = parseRegistrationCertificate('bir_cor', page(bir2019(), 540, 960), TODAY);
    expect(values(r.fields)).toEqual({
      tin: '123-456-789-00000',
      company_name: 'JDC HAULING SERVICES',
      registered_address: '45 RIZAL AVE BRGY TABON I KAWIT CAVITE 4104',
      registration_date: '2024-08-01',
    });
  });

  it('names a corporation as registered, not by its trade name', () => {
    const rows = bir2019({ name: 'GAMMA LOGISTICS CORPORATION', type: ['DOMESTIC CORPORATION'], trade: 'GAMMA EXPRESS' });
    expect(parseRegistrationCertificate('bir_cor', page(rows, 540, 960), TODAY).fields.company_name?.value).toBe('GAMMA LOGISTICS CORPORATION');
  });

  it('falls back to the taxpayer name when an individual has no trade name', () => {
    const rows = bir2019({ trade: '' });
    expect(parseRegistrationCertificate('bir_cor', page(rows, 540, 960), TODAY).fields.company_name?.value).toBe('DELA CRUZ, JUAN SANTOS');
  });

  it('reads a wrapped two-line taxpayer name whole', () => {
    const rows = bir2019({ name: 'BENGUET HIGHLANDS FARMERS', type: ['NON-STOCK CORPORATION'] });
    rows.splice(12, 0, ['FEDERATED ASSOCIATION INC.', 180, 325, 330, 333]);
    expect(parseRegistrationCertificate('bir_cor', page(rows, 540, 960), TODAY).fields.company_name?.value).toBe(
      'BENGUET HIGHLANDS FARMERS FEDERATED ASSOCIATION INC.',
    );
  });

  it('repairs O/0 between digits but reads no TIN from a malformed branch or the blank form', () => {
    const repaired = bir2019({ tin: '123-456-78O-00000' });
    expect(parseRegistrationCertificate('bir_cor', page(repaired, 540, 960), TODAY).fields.tin?.value).toBe('123-456-780-00000');
    for (const tin of ['123-456-789-0000', '000-000-000-00000']) {
      expect(parseRegistrationCertificate('bir_cor', page(bir2019({ tin }), 540, 960), TODAY).fields.tin, tin).toBeUndefined();
    }
  });

  it('does not recognise an SEC certificate uploaded as the 2303', () => {
    expect(parseRegistrationCertificate('bir_cor', text(SEC_DIGITAL), TODAY)).toEqual({ layout: null, fields: {} });
  });
});

describe('parseRegistrationCertificate: other papers', () => {
  it('leaves the DTI certificate and the National ID to their own read', () => {
    expect(parseRegistrationCertificate('dti_certificate', text(SEC_DIGITAL), TODAY)).toEqual({ layout: null, fields: {} });
  });
});
