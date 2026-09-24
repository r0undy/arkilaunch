import { z } from 'zod';

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

export const TruckSettingsSchema = z
  .object({
    baseFeePhp: z.number().nonnegative().max(1_000_000),
    driverFeePhp: z.number().nonnegative().max(1_000_000),
    extras: z.array(TruckExtraSchema).max(20),
  })
  .strict();
export type TruckSettings = z.infer<typeof TruckSettingsSchema>;

const Place = z.string().trim().min(5).max(300);

export const TruckEstimateRequestSchema = z.object({ pickup: Place, dropoff: Place }).strict();
export type TruckEstimateRequest = z.infer<typeof TruckEstimateRequestSchema>;

export const TruckRequestCreateSchema = TruckEstimateRequestSchema.extend({
  scheduledFor: z.coerce.date(),
  notes: z.string().trim().max(1000).optional(),
}).strict();
export type TruckRequestCreate = z.infer<typeof TruckRequestCreateSchema>;

export const TruckAgreeSchema = z.object({ pricePhp: z.number().positive().max(100_000_000) }).strict();
export type TruckAgree = z.infer<typeof TruckAgreeSchema>;

export const TruckKmConfirmSchema = z.object({ km: z.number().positive().max(5000) }).strict();
export type TruckKmConfirm = z.infer<typeof TruckKmConfirmSchema>;

export interface TruckPriceLine {
  label: string;
  amountPhp: number;
}
export interface TruckPrice {
  km: number;
  lines: TruckPriceLine[];
  totalPhp: number;
}

export interface TruckPriceInput {
  km: number;
  settings: TruckSettings;
  // From pricing_parameters and the resolved diesel price.
  perKmPhp: number;
  fuelLPerKm: number;
  dieselPhp: number;
}

const peso = (n: number) => Math.round(n * 100) / 100;

// Pure: the one place the truck price is computed, on the server for the
// estimate and again when the admin confirms the km.
export function priceTruckTrip({ km, settings, perKmPhp, fuelLPerKm, dieselPhp }: TruckPriceInput): TruckPrice {
  const lines: TruckPriceLine[] = [
    { label: 'Base fee', amountPhp: peso(settings.baseFeePhp) },
    { label: `Distance (${km} km × ₱${perKmPhp}/km)`, amountPhp: peso(km * perKmPhp) },
    { label: `Fuel (${km} km × ${fuelLPerKm} L/km × ₱${dieselPhp}/L)`, amountPhp: peso(km * fuelLPerKm * dieselPhp) },
    { label: "Driver's fee", amountPhp: peso(settings.driverFeePhp) },
    ...settings.extras.map((x) => ({
      label: x.per === 'km' ? `${x.label} (${km} km × ₱${x.amountPhp})` : x.label,
      amountPhp: peso(x.per === 'km' ? km * x.amountPhp : x.amountPhp),
    })),
  ];
  return { km, lines, totalPhp: peso(lines.reduce((sum, l) => sum + l.amountPhp, 0)) };
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
  createdAt: string;
}
