import { z } from 'zod';
import { FORMULA_BASE_VARS, FormulaError, evaluateFormula, formulaVarName } from './formula.js';
import { PaginationQuerySchema } from './pagination.js';

// Self-loading truck service. The per-km and fuel inputs are the tenant's
// existing pricing parameters and diesel price (the same ones every equipment
// quote uses); what a tenant sets here is only the truck's own fees plus any
// extra charges the admin wants to add.

export const TruckExtraSchema = z.object({
  label: z.string().trim().min(1).max(80),
  amountPhp: z.number().nonnegative().max(1_000_000),
  per: z.enum(['trip', 'km']),
});
export type TruckExtra = z.infer<typeof TruckExtraSchema>;

// The current priceTruckTrip() sum as a formula; `extras` is every extra
// summed (per-km ones times km), each extra is also its own variable.
export const DEFAULT_TRUCK_FORMULA = 'base + km * per_km + km * fuel_l_per_km * diesel + driver_fee + extras + tolls';

// The tenant's internal trip cost policy (0071): staff-only, never on a
// customer response. Every part is optional; 'none' leaves it out.
const Php = z.number().nonnegative().max(1_000_000);
export const TruckCostPolicySchema = z
  .object({
    // Fuel cost = km × fuelFactor × diesel × round trip. Null = the
    // tenant's pricing-parameter fuel L/km. The unit is the tenant's own.
    fuelFactor: z.number().positive().max(100).nullable().default(null),
    miscAllowancePhp: Php.default(0),
    helper: z
      .object({ kind: z.enum(['none', 'fixed', 'per_km', 'pct_driver']), value: Php })
      .strict()
      .default({ kind: 'none', value: 0 }),
    maintenance: z
      .object({ kind: z.enum(['none', 'fixed', 'per_km', 'pct_fuel']), value: Php })
      .strict()
      .default({ kind: 'none', value: 0 }),
  })
  .strict();
export type TruckCostPolicy = z.infer<typeof TruckCostPolicySchema>;
export const DEFAULT_TRUCK_COST_POLICY: TruckCostPolicy = TruckCostPolicySchema.parse({});

export const TruckSettingsSchema = z
  .object({
    baseFeePhp: z.number().nonnegative().max(1_000_000),
    driverFeePhp: z.number().nonnegative().max(1_000_000),
    extras: z.array(TruckExtraSchema).max(20),
    // Null/absent = DEFAULT_TRUCK_FORMULA.
    formula: z.string().trim().max(500).nullish(),
    // The estimate is shown as total ± rangePct; the high end is the cap.
    rangePct: z.number().min(0).max(100).default(10),
    // Legacy: trucks now price on the national diesel average; not read.
    region: z.string().trim().min(1).max(40).default('NCR'),
    // 0071: formula variables round_trip and quote_multiplier (e.g. a
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

// Map pins, when given, are routed as-is (no geocoding).
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
  // A pickup in the past can never be run.
  scheduledFor: z.coerce.date().refine((d) => d.getTime() > Date.now(), { message: 'scheduledFor must be in the future' }),
  notes: z.string().trim().max(1000).optional(),
  // The company the trip is booked for (one of the caller's own; checkout
  // needs it verified), and what goes on the truck, which both sides read.
  customerId: z.string().uuid(),
  loadDescription: z.string().trim().min(1).max(300),
  // Optional: one of that company's sites, which pins the drop-off. A
  // truck trip serves the company, so the site needs no proof.
  projectSiteId: z.string().uuid().optional(),
}).strict();
export type TruckRequestCreate = z.infer<typeof TruckRequestCreateSchema>;

export const TruckAgreeSchema = z.object({ pricePhp: z.number().positive().max(100_000_000) }).strict();
export type TruckAgree = z.infer<typeof TruckAgreeSchema>;

// POST /me/truck-requests/:id/approve-price: the customer accepts the price
// they were shown. A staff change in between makes it a 409, never a
// silent accept of a figure they did not see.
export const TruckAcceptPriceSchema = z.object({ pricePhp: z.number().positive().max(100_000_000) }).strict();
export type TruckAcceptPrice = z.infer<typeof TruckAcceptPriceSchema>;

// PATCH /truck-requests/:id/crew: who drives and loads (site hub personnel).
export const TruckCrewSchema = z
  .object({
    driverName: z.string().trim().max(120).nullable(),
    helperName: z.string().trim().max(120).nullable(),
  })
  .strict();
export type TruckCrew = z.infer<typeof TruckCrewSchema>;

// A manual toll amount, when given, replaces the picked tolls with one
// line (0 = no tolls on this trip).
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
  // total ± the tenant's rangePct; highPhp is the cap a request locks.
  lowPhp?: number;
  highPhp?: number;
}

// The road route between two pins, for drawing on a map: [lng, lat] pairs
// (GeoJSON order), simplified by the router. An estimate, like the km.
export interface TruckRoute {
  km: number;
  minutes: number;
  line: [number, number][];
  truckSafe?: boolean;
  cities?: RouteCity[];
  // Staff route only: the expressways the road route runs on, for the toll
  // picker's suggestion (ph-tolls.ts suggestTolls).
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

// Evaluate the rule in Philippine civil time. Overnight windows inherit the
// previous day's start day. Return the end instant so dispatch can wait.
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

// POST /me/truck-requests/estimate. `route` is null when the router gave
// no geometry.
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
  // Set on an expressway matrix fee; null on a free-named toll.
  expressway: string | null;
  entryPoint: string | null;
  exitPoint: string | null;
  vehicleClass: number;
  asOf: string | null;
}

export interface TruckPriceInput {
  km: number;
  settings: FormulaSettings & Pick<TruckSettings, 'formula'>;
  // From pricing_parameters and the resolved diesel price.
  perKmPhp: number;
  fuelLPerKm: number;
  dieselPhp: number;
  tolls?: TruckPriceLine[];
}

// The multipliers default to 1, so settings saved before 0071 price as before.
type FormulaSettings = Pick<TruckSettings, 'baseFeePhp' | 'driverFeePhp' | 'extras'> &
  Partial<Pick<TruckSettings, 'roundTripMultiplier' | 'quoteMultiplier'>>;

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
    driver_fee: settings.driverFeePhp,
    tolls: tollsPhp,
    // ponytail: requests carry no load weight yet, so weight_t is 0.
    weight_t: 0,
    extras,
  };
}

const peso = (n: number) => Math.round(n * 100) / 100;

// Pure: the one place the truck price is computed, on the server for the
// estimate and again when the admin confirms the km.
export function priceTruckTrip({ km, settings, perKmPhp, fuelLPerKm, dieselPhp, tolls = [] }: TruckPriceInput): TruckPrice {
  const lines: TruckPriceLine[] = [
    { label: 'Base fee', amountPhp: peso(settings.baseFeePhp) },
    { label: `Distance (${km} km × ₱${perKmPhp}/km)`, amountPhp: peso(km * perKmPhp) },
    { label: `Fuel (${km} km × ${fuelLPerKm} L/km × ₱${dieselPhp}/L)`, amountPhp: peso(km * fuelLPerKm * dieselPhp) },
    { label: "Driver's fee", amountPhp: peso(settings.driverFeePhp) },
    ...settings.extras.map((x) => ({
      label: x.per === 'km' ? `${x.label} (${km} km × ₱${x.amountPhp})` : x.label,
      amountPhp: peso(x.per === 'km' ? km * x.amountPhp : x.amountPhp),
    })),
    ...tolls.map((t) => ({ label: `Toll: ${t.label}`, amountPhp: peso(t.amountPhp) })),
  ];
  const sum = peso(lines.reduce((acc, l) => acc + l.amountPhp, 0));
  if (!settings.formula || settings.formula === DEFAULT_TRUCK_FORMULA) return { km, lines, totalPhp: sum };
  // A custom formula sets the total; the breakdown stays, and the gap to it
  // shows as one adjustment line.
  const tollsPhp = tolls.reduce((acc, t) => acc + t.amountPhp, 0);
  const totalPhp = peso(Math.max(0, evaluateFormula(settings.formula, formulaVars(settings, km, perKmPhp, fuelLPerKm, dieselPhp, tollsPhp))));
  if (totalPhp !== sum) lines.push({ label: 'Formula adjustment', amountPhp: peso(totalPhp - sum) });
  return { km, lines, totalPhp };
}

export interface TruckCostInput {
  km: number;
  settings: Pick<TruckSettings, 'driverFeePhp' | 'extras'> & Partial<Pick<TruckSettings, 'roundTripMultiplier' | 'costPolicy'>>;
  fuelLPerKm: number;
  dieselPhp: number;
  tolls?: TruckPriceLine[];
}

// Pure: the tenant's estimated operating cost of one trip, from its own
// policy. Only configured parts appear; nothing is added to reach a target.
// Driver is the existing per-trip fee (a per-km driver rule is future work).
// Tolls and extra charges are passed through as cost.
export function estimateTruckCost({ km, settings, fuelLPerKm, dieselPhp, tolls = [] }: TruckCostInput): { lines: TruckPriceLine[]; totalPhp: number } {
  const policy = settings.costPolicy ?? DEFAULT_TRUCK_COST_POLICY;
  const roundTrip = settings.roundTripMultiplier ?? 1;
  const factor = policy.fuelFactor ?? fuelLPerKm;
  const fuel = peso(km * factor * dieselPhp * roundTrip);
  const driver = peso(settings.driverFeePhp);
  const lines: TruckPriceLine[] = [{ label: `Fuel (${km} km × ${factor} × ₱${dieselPhp} × ${roundTrip})`, amountPhp: fuel }];
  if (driver > 0) lines.push({ label: 'Driver', amountPhp: driver });
  const { helper, maintenance } = policy;
  const helperPhp = { none: 0, fixed: helper.value, per_km: km * helper.value, pct_driver: (driver * helper.value) / 100 }[helper.kind];
  if (helper.kind !== 'none') lines.push({ label: 'Helper', amountPhp: peso(helperPhp) });
  const maintPhp = { none: 0, fixed: maintenance.value, per_km: km * maintenance.value, pct_fuel: (fuel * maintenance.value) / 100 }[maintenance.kind];
  if (maintenance.kind !== 'none') lines.push({ label: 'Maintenance', amountPhp: peso(maintPhp) });
  if (policy.miscAllowancePhp > 0) lines.push({ label: 'Miscellaneous allowance', amountPhp: peso(policy.miscAllowancePhp) });
  for (const x of settings.extras) lines.push({ label: x.label, amountPhp: peso(x.per === 'km' ? km * x.amountPhp : x.amountPhp) });
  for (const t of tolls) lines.push({ label: `Toll: ${t.label}`, amountPhp: peso(t.amountPhp) });
  return { lines, totalPhp: peso(lines.reduce((acc, l) => acc + l.amountPhp, 0)) };
}

// Saved on the request when it is priced (0071), so a later policy change
// never alters a quoted trip. Staff-only.
export interface TruckInternal {
  cost: { lines: TruckPriceLine[]; totalPhp: number };
  // Null when the tenant sets no max discount.
  floorPhp: number | null;
  maxDiscountPct: number | null;
}

export function negotiationFloor(recommendedPhp: number, maxDiscountPct: number | null): number | null {
  return maxDiscountPct === null ? null : peso(recommendedPhp * (1 - maxDiscountPct / 100));
}

// Profit on the agreed price, else on the route price.
export function truckProfit(pricePhp: number, costPhp: number): { profitPhp: number; marginPct: number | null } {
  const profitPhp = peso(pricePhp - costPhp);
  return { profitPhp, marginPct: pricePhp > 0 ? Math.round((profitPhp / pricePhp) * 10_000) / 100 : null };
}

export const TRUCK_REQUEST_STATUSES =['estimated', 'km_confirmed', 'agreed', 'paid', 'dispatched', 'cancelled'] as const;
export type TruckRequestStatus = (typeof TRUCK_REQUEST_STATUSES)[number];
// Nothing left to do on these: the rest are "open".
export const CLOSED_TRUCK_STATUSES: readonly TruckRequestStatus[] = ['paid', 'dispatched', 'cancelled'];

// GET /truck-requests and /me/truck-requests. `q` finds a TRK- code by
// prefix, as GET /bookings does; `status` splits open from closed.
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
  // TRK-YYYY-NNNN (booking-code.ts); the same reference shape as a rental's.
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
  // The negotiated price staff accepted; what the invoice charges. Null
  // until agreed.
  agreedPricePhp: number | null;
  // The high end of the request-time estimate; staff are warned when the
  // agreed price goes above it.
  capPhp: number | null;
  // The agreed price the customer last accepted. Checkout needs it to equal
  // agreedPricePhp: every staff price change is accepted again.
  acceptedPricePhp: number | null;
  callRequestedAt: string | null;
  callConfirmedAt: string | null;
  // Optional since 0067; null on requests made before 0055.
  projectSiteId: string | null;
  // 0067: the company the trip is for and what it carries (null on older
  // requests), and who asked, so staff can call them.
  customerId: string | null;
  companyName: string | null;
  loadDescription: string | null;
  requesterName: string | null;
  requesterPhone: string | null;
  // Crew on the trip (0059); null until staff name them.
  driverName: string | null;
  helperName: string | null;
  // The exact map pins, when the customer dropped them (0037).
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  createdAt: string;
  // Staff responses only (never a customer's): the saved cost and floor,
  // and profit on the agreed (else route) price. Absent on requests priced
  // before 0071.
  internal?: TruckInternal & { profitPhp: number; marginPct: number | null };
}
