import { z } from 'zod';
import { FORMULA_BASE_VARS, FormulaError, evaluateFormula, formulaVarName } from './formula.js';

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

export const TruckSettingsSchema = z
  .object({
    baseFeePhp: z.number().nonnegative().max(1_000_000),
    driverFeePhp: z.number().nonnegative().max(1_000_000),
    extras: z.array(TruckExtraSchema).max(20),
    // Null/absent = DEFAULT_TRUCK_FORMULA.
    formula: z.string().trim().max(500).nullish(),
    // The estimate is shown as total ± rangePct; the high end is the cap.
    rangePct: z.number().min(0).max(100).default(10),
    // The diesel price / pricing_parameters region the tenant prices in.
    region: z.string().trim().min(1).max(40).default('NCR'),
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
}).strict();
export type TruckRequestCreate = z.infer<typeof TruckRequestCreateSchema>;

export const TruckAgreeSchema = z.object({ pricePhp: z.number().positive().max(100_000_000) }).strict();
export type TruckAgree = z.infer<typeof TruckAgreeSchema>;

export const TruckKmConfirmSchema = z
  .object({ km: z.number().positive().max(5000), tollRateIds: z.array(z.string().uuid()).max(20).optional() })
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

export const TollRateCreateSchema = z
  .object({ name: z.string().trim().min(1).max(80), feePhp: z.number().nonnegative().max(1_000_000) })
  .strict();
export type TollRateCreate = z.infer<typeof TollRateCreateSchema>;
export interface TollRateResponse {
  id: string;
  name: string;
  feePhp: number;
}

export interface TruckPriceInput {
  km: number;
  settings: Pick<TruckSettings, 'baseFeePhp' | 'driverFeePhp' | 'extras' | 'formula'>;
  // From pricing_parameters and the resolved diesel price.
  perKmPhp: number;
  fuelLPerKm: number;
  dieselPhp: number;
  tolls?: TruckPriceLine[];
}

function formulaVars(
  settings: Pick<TruckSettings, 'baseFeePhp' | 'driverFeePhp' | 'extras'>,
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

export const TRUCK_REQUEST_STATUSES = ['estimated', 'km_confirmed', 'agreed', 'paid', 'cancelled'] as const;
export type TruckRequestStatus = (typeof TRUCK_REQUEST_STATUSES)[number];

export interface TruckRequestResponse {
  id: string;
  pickup: string;
  dropoff: string;
  scheduledFor: string;
  notes: string | null;
  estimatedKm: number;
  confirmedKm: number | null;
  status: TruckRequestStatus;
  price: TruckPrice;
  // The negotiated price staff accepted; what the invoice charges. Null
  // until agreed.
  agreedPricePhp: number | null;
  // Locked at request time; charging above it needs the customer's OK.
  capPhp: number | null;
  callRequestedAt: string | null;
  callConfirmedAt: string | null;
  createdAt: string;
}
