import { z } from 'zod';
import { FORMULA_BASE_VARS, FormulaError, evaluateFormula, formulaVarName } from './formula.js';
import { PaginationQuerySchema } from './pagination.js';
import { round2HalfUp } from './pricing.js';

export const TruckExtraSchema = z.object({
  label: z.string().trim().min(1).max(80),
  amountPhp: z.number().nonnegative().max(1_000_000),
  per: z.enum(['trip', 'km']),
});
export type TruckExtra = z.infer<typeof TruckExtraSchema>;

export const DEFAULT_TRUCK_FORMULA = 'base + km * per_km + km * fuel_l_per_km * diesel + driver_fee + extras + tolls';

// The tenant's internal trip cost policy (0072): staff-only, never on a
// customer response. Every part is optional; 'none' leaves it out.
const Php = z.number().nonnegative().max(1_000_000);
// A policy saved before misc took a unit had a flat miscAllowancePhp.
const legacyMisc = (v: unknown) => {
  if (!v || typeof v !== 'object' || !('miscAllowancePhp' in v)) return v;
  const { miscAllowancePhp, ...rest } = v as Record<string, unknown>;
  return 'misc' in rest || !miscAllowancePhp ? rest : { ...rest, misc: { kind: 'fixed', value: miscAllowancePhp } };
};
export const TruckCostPolicySchema = z.preprocess(legacyMisc, z
  .object({
    // Fuel cost = km × fuelFactor (litres per km) × diesel × round trip.
    // Null = the tenant's pricing-parameter fuel L/km.
    fuelFactor: z.number().positive().max(100).nullable().default(null),
    misc: z
      .object({ kind: z.enum(['none', 'fixed', 'per_km']), value: Php })
      .strict()
      .default({ kind: 'none', value: 0 }),
    helper: z
      .object({ kind: z.enum(['none', 'fixed', 'per_km', 'pct_driver']), value: Php })
      .strict()
      .default({ kind: 'none', value: 0 }),
    maintenance: z
      .object({ kind: z.enum(['none', 'fixed', 'per_km', 'pct_fuel']), value: Php })
      .strict()
      .default({ kind: 'none', value: 0 }),
    // Tenant-named cost lines the parts above do not cover (e.g. a cost the
    // tenant has not itemised yet). Same shape as an extra charge.
    otherCosts: z.array(TruckExtraSchema).max(10).default([]),
  })
  .strict());
export type TruckCostPolicy = z.infer<typeof TruckCostPolicySchema>;
export const DEFAULT_TRUCK_COST_POLICY: TruckCostPolicy = TruckCostPolicySchema.parse({});

export const TruckSettingsSchema = z
  .object({
    baseFeePhp: z.number().nonnegative().max(1_000_000),
    // Legacy fixed driver fee; the admin sets driverRatePhpPerKm (0075).
    driverFeePhp: z.number().nonnegative().max(1_000_000),
    driverRatePhpPerKm: z.number().nonnegative().max(100_000).default(0),
    // 0076: what the customer sees. 'cost_items' = the actual cost items
    // plus remainderLabel up to the formula total (costItemQuoteLines).
    quoteBreakdown: z.enum(['formula', 'cost_items']).default('formula'),
    remainderLabel: z.string().trim().min(1).max(80).default('Truck trip cost'),
    // 0077: a trip at or under minFeeMaxKm km is charged minFeePhp instead
    // of the formula. Null = off.
    minFeeMaxKm: z.number().positive().max(5000).nullable().default(null),
    minFeePhp: z.number().nonnegative().max(1_000_000).default(0),
    extras: z.array(TruckExtraSchema).max(20),
    formula: z.string().trim().max(500).nullish(),
    rangePct: z.number().min(0).max(100).default(10),
    // Legacy: not read.
    region: z.string().trim().min(1).max(40).default('NCR'),
    // 0072: formula variables round_trip and quote_multiplier (e.g. a
    // tenant's `km * round_trip * diesel * quote_multiplier`). Round trip
    // also scales the internal fuel cost.
    roundTripMultiplier: z.number().positive().max(10).default(1),
    quoteMultiplier: z.number().positive().max(100).default(1),
    // Negotiation floor = the route price × (1 - maxDiscountPct/100). The
    // admin is warned below it, never blocked. Null = no floor. Separate
    // from rangePct, which is only the estimate band.
    maxDiscountPct: z.number().min(0).max(100).nullable().default(null),
    costPolicy: TruckCostPolicySchema.default(DEFAULT_TRUCK_COST_POLICY),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (!s.formula) return;
    try {
      evaluateFormula(s.formula, formulaVars(s, 1, 1, 1, 1, 1));
    } catch (e) {
      ctx.addIssue({ code: 'custom', path: ['formula'], message: e instanceof FormulaError ? e.message : 'invalid formula' });
    }
  });
export type TruckSettings = z.infer<typeof TruckSettingsSchema>;

const Place = z.string().trim().min(5).max(300);
const Lat = z.number().min(-90).max(90);
const Lng = z.number().min(-180).max(180);

export const TruckEstimateRequestSchema = z
  .object({
    pickup: Place,
    dropoff: Place,
    pickupLat: Lat.optional(),
    pickupLng: Lng.optional(),
    dropoffLat: Lat.optional(),
    dropoffLng: Lng.optional(),
  })
  .strict();
export type TruckEstimateRequest = z.infer<typeof TruckEstimateRequestSchema>;

export const TruckRequestCreateSchema = TruckEstimateRequestSchema.extend({
  scheduledFor: z.coerce.date().refine((d) => d.getTime() > Date.now(), { message: 'scheduledFor must be in the future' }),
  notes: z.string().trim().max(1000).optional(),
  // One of the caller's own companies, verified server-side.
  customerId: z.string().uuid(),
  loadDescription: z.string().trim().min(1).max(300),
  projectSiteId: z.string().uuid().optional(),
}).strict();
export type TruckRequestCreate = z.infer<typeof TruckRequestCreateSchema>;

export const TruckAgreeSchema = z.object({ pricePhp: z.number().positive().max(100_000_000) }).strict();
export type TruckAgree = z.infer<typeof TruckAgreeSchema>;

// A staff change in between is a 409, never a silent accept of a figure they did not see.
export const TruckAcceptPriceSchema = z.object({ pricePhp: z.number().positive().max(100_000_000) }).strict();
export type TruckAcceptPrice = z.infer<typeof TruckAcceptPriceSchema>;

export const TruckCrewSchema = z
  .object({
    driverName: z.string().trim().max(120).nullable(),
    helperName: z.string().trim().max(120).nullable(),
  })
  .strict();
export type TruckCrew = z.infer<typeof TruckCrewSchema>;

export const TruckKmConfirmSchema = z
  .object({
    km: z.number().positive().max(5000),
    tollRateIds: z.array(z.string().uuid()).max(20).optional(),
    manualTollPhp: z.number().nonnegative().max(1_000_000).optional(),
  })
  .strict();
export type TruckKmConfirm = z.infer<typeof TruckKmConfirmSchema>;

export interface TruckPriceLine {
  label: string;
  amountPhp: number;
}
export interface TruckPrice {
  km: number;
  lines: TruckPriceLine[];
  totalPhp: number;
  lowPhp?: number;
  highPhp?: number;
}

export interface TruckRoute {
  km: number;
  minutes: number;
  line: [number, number][];
  truckSafe?: boolean;
  cities?: RouteCity[];
  // Staff route only.
  tollHints?: TollHint[];
}

export interface RouteCity { city: string; province: string }

const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const TruckBanRuleSchema = z.object({
  city: z.string().trim().min(1).max(100),
  province: z.string().trim().min(1).max(100),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  windows: z.array(z.object({ from: ClockTime, to: ClockTime }).refine((w) => w.from !== w.to)).min(1).max(8),
  minGvwKg: z.number().int().positive().max(100_000).nullable(),
  permitNote: z.string().trim().max(500),
  verified: z.boolean(),
}).strict();
export type TruckBanRuleInput = z.infer<typeof TruckBanRuleSchema>;
export interface TruckBanRule extends TruckBanRuleInput { id: string }
export interface TruckBanHit { city: string; window: string; permitNote: string; verified: boolean; endAt: Date }

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const minutesOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

// Philippine civil time; overnight windows inherit the previous day's start day.
export function banHits(cities: RouteCity[], rules: TruckBanRuleInput[], at: Date): TruckBanHit[] {
  const local = new Date(at.getTime() + PH_OFFSET_MS);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const day = local.getUTCDay();
  return rules.flatMap((rule) => {
    const cityName = (name: string) => name.toLowerCase().replace(/^city of\s+/, '').replace(/\s+city$/, '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!cities.some((place) => cityName(place.city) === cityName(rule.city) &&
      (!rule.province || place.province.toLowerCase() === rule.province.toLowerCase() ||
        ['metro manila', 'national capital region'].includes(place.province.toLowerCase()) &&
        ['metro manila', 'national capital region'].includes(rule.province.toLowerCase())))) return [];
    return rule.windows.flatMap(({ from, to }) => {
      const start = minutesOf(from);
      const end = minutesOf(to);
      const overnight = end < start;
      const inside = overnight
        ? (minute >= start && rule.days.includes(day)) || (minute < end && rule.days.includes((day + 6) % 7))
        : rule.days.includes(day) && minute >= start && minute < end;
      if (!inside) return [];
      const endDay = overnight && minute >= start ? 1 : 0;
      const midnightUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
      return [{ city: rule.city, window: `${from}-${to}`, permitNote: rule.permitNote,
        verified: rule.verified, endAt: new Date(midnightUtc + (endDay * 1440 + end) * 60_000 - PH_OFFSET_MS) }];
    });
  });
}

export function truckEta(dispatchedAt: Date, routeMinutes: number, cities: RouteCity[], rules: TruckBanRuleInput[]): Date {
  let eta = new Date(dispatchedAt.getTime() + Math.max(0, routeMinutes) * 60_000);
  for (let i = 0; i < 16; i++) {
    const hits = banHits(cities, rules, eta);
    if (!hits.length) break;
    const end = Math.max(...hits.map((hit) => hit.endAt.getTime()));
    if (end <= eta.getTime()) break;
    eta = new Date(end);
  }
  return eta;
}

export interface TollHint {
  expressway: string;
  entry: string | null;
  exit: string | null;
}

export type TruckEstimateResponse = TruckPrice & { route: TruckRoute | null };

export const TollRateCreateSchema = z
  .object({ name: z.string().trim().min(1).max(80), feePhp: z.number().nonnegative().max(1_000_000) })
  .strict();
export type TollRateCreate = z.infer<typeof TollRateCreateSchema>;
export const TollRateUpdateSchema = z.object({ feePhp: z.number().nonnegative().max(1_000_000) }).strict();
export type TollRateUpdate = z.infer<typeof TollRateUpdateSchema>;
export interface TollRateResponse {
  id: string;
  name: string;
  feePhp: number;
  expressway: string | null;
  entryPoint: string | null;
  exitPoint: string | null;
  vehicleClass: number;
  asOf: string | null;
}

export interface TruckPriceInput {
  km: number;
  settings: FormulaSettings & Pick<TruckSettings, 'formula'> & Partial<Pick<TruckSettings, 'minFeeMaxKm' | 'minFeePhp'>>;
  // From pricing_parameters and the resolved diesel price.
  perKmPhp: number;
  fuelLPerKm: number;
  dieselPhp: number;
  tolls?: TruckPriceLine[];
}

// The multipliers default to 1, so settings saved before 0072 price as before.
type FormulaSettings = Pick<TruckSettings, 'baseFeePhp' | 'driverFeePhp' | 'extras'> &
  Partial<Pick<TruckSettings, 'roundTripMultiplier' | 'quoteMultiplier' | 'driverRatePhpPerKm'>>;

// Driver pay for one trip: trip km (one-way) × the tenant's rate, plus any legacy fixed fee.
export const driverPay = (settings: Pick<TruckSettings, 'driverFeePhp'> & Partial<Pick<TruckSettings, 'driverRatePhpPerKm'>>, km: number) =>
  round2HalfUp(settings.driverFeePhp + km * (settings.driverRatePhpPerKm ?? 0));

function formulaVars(
  settings: FormulaSettings,
  km: number,
  perKmPhp: number,
  fuelLPerKm: number,
  dieselPhp: number,
  tollsPhp = 0,
): Record<string, number> {
  const vars: Record<string, number> = {};
  let extras = 0;
  for (const x of settings.extras) {
    const amount = x.per === 'km' ? km * x.amountPhp : x.amountPhp;
    extras += amount;
    const name = formulaVarName(x.label);
    if (name && !(FORMULA_BASE_VARS as readonly string[]).includes(name)) vars[name] = amount;
  }
  return {
    ...vars,
    km,
    base: settings.baseFeePhp,
    per_km: perKmPhp,
    diesel: dieselPhp,
    fuel_l_per_km: fuelLPerKm,
    round_trip: settings.roundTripMultiplier ?? 1,
    quote_multiplier: settings.quoteMultiplier ?? 1,
    driver_fee: driverPay(settings, km),
    tolls: tollsPhp,
    // ponytail: requests carry no load weight yet, so weight_t is 0.
    weight_t: 0,
    extras,
  };
}

// The one place the truck price is computed (estimate and the admin's km confirm).
export function priceTruckTrip({ km, settings, perKmPhp, fuelLPerKm, dieselPhp, tolls = [] }: TruckPriceInput): TruckPrice {
  if (settings.minFeeMaxKm != null && km <= settings.minFeeMaxKm) {
    const fee = round2HalfUp(settings.minFeePhp ?? 0);
    return { km, lines: [{ label: `Short-trip fee (up to ${settings.minFeeMaxKm} km)`, amountPhp: fee }], totalPhp: fee };
  }
  const lines: TruckPriceLine[] = [
    { label: 'Base fee', amountPhp: round2HalfUp(settings.baseFeePhp) },
    { label: `Distance (${km} km × ₱${perKmPhp}/km)`, amountPhp: round2HalfUp(km * perKmPhp) },
    { label: `Fuel (${km} km × ${fuelLPerKm} L/km × ₱${dieselPhp}/L)`, amountPhp: round2HalfUp(km * fuelLPerKm * dieselPhp) },
    {
      label: settings.driverRatePhpPerKm ? `Driver (${km} km × ₱${settings.driverRatePhpPerKm})` : "Driver's fee",
      amountPhp: driverPay(settings, km),
    },
    ...settings.extras.map((x) => ({
      label: x.per === 'km' ? `${x.label} (${km} km × ₱${x.amountPhp})` : x.label,
      amountPhp: round2HalfUp(x.per === 'km' ? km * x.amountPhp : x.amountPhp),
    })),
    ...tolls.map((t) => ({ label: `Toll: ${t.label}`, amountPhp: round2HalfUp(t.amountPhp) })),
  ];
  const sum = round2HalfUp(lines.reduce((acc, l) => acc + l.amountPhp, 0));
  if (!settings.formula || settings.formula === DEFAULT_TRUCK_FORMULA) return { km, lines, totalPhp: sum };
  const tollsPhp = tolls.reduce((acc, t) => acc + t.amountPhp, 0);
  const totalPhp = round2HalfUp(Math.max(0, evaluateFormula(settings.formula, formulaVars(settings, km, perKmPhp, fuelLPerKm, dieselPhp, tollsPhp))));
  if (totalPhp !== sum) lines.push({ label: 'Formula adjustment', amountPhp: round2HalfUp(totalPhp - sum) });
  return { km, lines, totalPhp };
}

export interface TruckCostInput {
  km: number;
  settings: Pick<TruckSettings, 'driverFeePhp' | 'extras'> & Partial<Pick<TruckSettings, 'roundTripMultiplier' | 'costPolicy' | 'driverRatePhpPerKm'>>;
  fuelLPerKm: number;
  dieselPhp: number;
  tolls?: TruckPriceLine[];
}

// Pure: the tenant's estimated operating cost of one trip, from its own
// policy. Only configured parts appear; nothing is added to reach a target.
// Driver is driverPay: trip km × the tenant's rate.
// Tolls and extra charges are passed through as cost.
export function estimateTruckCost({ km, settings, fuelLPerKm, dieselPhp, tolls = [] }: TruckCostInput): { lines: TruckPriceLine[]; totalPhp: number } {
  const policy = settings.costPolicy ?? DEFAULT_TRUCK_COST_POLICY;
  const roundTrip = settings.roundTripMultiplier ?? 1;
  const factor = policy.fuelFactor ?? fuelLPerKm;
  const fuel = round2HalfUp(km * factor * dieselPhp * roundTrip);
  const driver = driverPay(settings, km);
  const lines: TruckPriceLine[] = [{ label: `Fuel (${km} km × ${factor} L/km × ₱${dieselPhp} × ${roundTrip})`, amountPhp: fuel }];
  if (driver > 0) lines.push({ label: 'Driver', amountPhp: driver });
  const { helper, maintenance } = policy;
  const helperPhp = { none: 0, fixed: helper.value, per_km: km * helper.value, pct_driver: (driver * helper.value) / 100 }[helper.kind];
  if (helper.kind !== 'none') lines.push({ label: 'Helper', amountPhp: round2HalfUp(helperPhp) });
  const maintPhp = { none: 0, fixed: maintenance.value, per_km: km * maintenance.value, pct_fuel: (fuel * maintenance.value) / 100 }[maintenance.kind];
  if (maintenance.kind !== 'none') lines.push({ label: 'Maintenance', amountPhp: round2HalfUp(maintPhp) });
  const { misc } = policy;
  const miscPhp = { none: 0, fixed: misc.value, per_km: km * misc.value }[misc.kind];
  if (miscPhp > 0) lines.push({ label: 'Miscellaneous allowance', amountPhp: round2HalfUp(miscPhp) });
  for (const x of [...(policy.otherCosts ?? []), ...settings.extras]) lines.push({ label: x.label, amountPhp: round2HalfUp(x.per === 'km' ? km * x.amountPhp : x.amountPhp) });
  for (const t of tolls) lines.push({ label: `Toll: ${t.label}`, amountPhp: round2HalfUp(t.amountPhp) });
  return { lines, totalPhp: round2HalfUp(lines.reduce((acc, l) => acc + l.amountPhp, 0)) };
}

// The customer's lines for a 'cost_items' tenant: each cost item at its
// actual amount under a plain name (no rates), then one remainder line up to
// the formula total, so the lines always sum to price.totalPhp. When the
// items exceed the total, the non-toll items are scaled down to fit instead.
export function costItemQuoteLines(
  price: TruckPrice,
  cost: { lines: TruckPriceLine[] },
  remainderLabel = 'Truck trip cost',
): TruckPriceLine[] {
  const plain = (label: string) => (label === 'Miscellaneous allowance' ? 'Miscellaneous' : label.replace(/\s*\(.*\)$/, ''));
  const items = cost.lines.map((l) => ({ label: plain(l.label), amountPhp: l.amountPhp }));
  const remainder = round2HalfUp(price.totalPhp - items.reduce((acc, l) => acc + l.amountPhp, 0));
  if (remainder >= 0) return remainder > 0 ? [...items, { label: remainderLabel, amountPhp: remainder }] : items;
  const isToll = (l: TruckPriceLine) => l.label.startsWith('Toll: ');
  const tolls = items.filter(isToll).reduce((acc, l) => acc + l.amountPhp, 0);
  const rest = items.filter((l) => !isToll(l)).reduce((acc, l) => acc + l.amountPhp, 0);
  if (rest <= 0 || tolls >= price.totalPhp) return price.lines;
  const factor = (price.totalPhp - tolls) / rest;
  const scaled = items.map((l) => (isToll(l) ? l : { ...l, amountPhp: round2HalfUp(l.amountPhp * factor) }));
  const drift = round2HalfUp(price.totalPhp - scaled.reduce((acc, l) => acc + l.amountPhp, 0));
  if (drift !== 0) {
    const largest = scaled.reduce((best, l, i) => (!isToll(l) && l.amountPhp > scaled[best]!.amountPhp ? i : best), scaled.findIndex((l) => !isToll(l)));
    scaled[largest] = { ...scaled[largest]!, amountPhp: round2HalfUp(scaled[largest]!.amountPhp + drift) };
  }
  return scaled;
}

// Saved on the request when it is priced (0072), so a later policy change
// never alters a quoted trip. Staff-only.
export interface TruckInternal {
  cost: { lines: TruckPriceLine[]; totalPhp: number };
  floorPhp: number | null;
  maxDiscountPct: number | null;
  // Which floor applied: the max discount, or break-even (the cost) when
  // that is higher. Absent on trips priced before it = 'discount'.
  floorBasis?: 'discount' | 'cost';
}

// The higher of the max-discount floor and break-even. Warns, never blocks.
export function negotiationFloor(
  recommendedPhp: number,
  maxDiscountPct: number | null,
  costPhp = 0,
): { floorPhp: number | null; floorBasis: 'discount' | 'cost' } {
  const discount = maxDiscountPct === null ? null : round2HalfUp(recommendedPhp * (1 - maxDiscountPct / 100));
  if (costPhp > 0 && (discount === null || costPhp > discount)) return { floorPhp: round2HalfUp(costPhp), floorBasis: 'cost' };
  return { floorPhp: discount, floorBasis: 'discount' };
}

// Profit on the agreed price, else on the route price.
export function truckProfit(pricePhp: number, costPhp: number): { profitPhp: number; marginPct: number | null } {
  const profitPhp = round2HalfUp(pricePhp - costPhp);
  return { profitPhp, marginPct: pricePhp > 0 ? Math.round((profitPhp / pricePhp) * 10_000) / 100 : null };
}

// Self-loading trucks are booked per trip in the truck flow, never rented from the equipment catalog.
export const isSelfLoadingTruckType = (typeName: string) => typeName.toLowerCase().replace(/[\s-]+/g, '') === 'selfloadingtruck';

export const TRUCK_REQUEST_STATUSES = ['estimated', 'km_confirmed', 'agreed', 'paid', 'dispatched', 'cancelled'] as const;
export type TruckRequestStatus = (typeof TRUCK_REQUEST_STATUSES)[number];
export const CLOSED_TRUCK_STATUSES: readonly TruckRequestStatus[] = ['paid', 'dispatched', 'cancelled'];

export const TruckRequestListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(40).optional(),
  status: z.enum(['open', 'closed']).optional(),
});
export type TruckRequestListQuery = z.infer<typeof TruckRequestListQuerySchema>;

export interface TruckRequestListResponse {
  items: TruckRequestResponse[];
  total: number;
}

export interface TruckRequestResponse {
  id: string;
  code: string;
  pickup: string;
  dropoff: string;
  scheduledFor: string;
  notes: string | null;
  estimatedKm: number;
  routeCities: RouteCity[] | null;
  routeMinutes: number | null;
  dispatchedAt: string | null;
  etaAt: string | null;
  confirmedKm: number | null;
  status: TruckRequestStatus;
  price: TruckPrice;
  agreedPricePhp: number | null;
  capPhp: number | null;
  // Checkout requires this to equal agreedPricePhp: every staff price change is accepted again.
  acceptedPricePhp: number | null;
  callRequestedAt: string | null;
  callConfirmedAt: string | null;
  projectSiteId: string | null;
  customerId: string | null;
  companyName: string | null;
  loadDescription: string | null;
  requesterName: string | null;
  requesterPhone: string | null;
  driverName: string | null;
  helperName: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  createdAt: string;
  // Staff responses only (never a customer's): the saved cost and floor,
  // and profit on the agreed (else route) price. Absent on requests priced
  // before 0072.
  internal?: TruckInternal & { profitPhp: number; marginPct: number | null };
}
