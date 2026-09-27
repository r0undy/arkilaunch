import { apiGet } from './api-client.js';

// Read-only pick-list data for the POC forms (GET /api/v1/reference/*).
export interface EquipmentTypeRef {
  id: string;
  name: string;
}
export interface EquipmentRef {
  id: string;
  model: string;
  serialNo: string;
  equipmentTypeId: string;
  availabilityStatus: string;
}
export interface RateCardRef {
  id: string;
  equipmentTypeId: string;
  // Set when the card overrides one unit of the type.
  equipmentId: string | null;
  rateType: string;
  rateValue: string;
  currency: string;
}
export interface RentalRef {
  id: string;
  // EQR-YYYY-NNNN, the booking code shown everywhere a rental is named.
  code: string;
  customerId: string;
  projectSiteId: string;
  status: string;
  // The booking's own dates; the server's span check (a unit's assignment
  // window, else these) is what actually decides.
  startDate?: string;
  endDate?: string | null;
}
export interface CustomerRef {
  id: string;
  companyName: string;
}
export interface ProjectSiteRef {
  id: string;
  latitude: string;
  longitude: string;
  city: string | null;
  province: string | null;
}

// Which capture paths the server will accept. With the OCR pipeline on, a
// paper scan must NOT carry transcribed hours (the API answers 422
// line_items_not_accepted), and the client had no way to know that.
export interface CapabilitiesRef {
  ocrPipeline: boolean;
  ocrKyc: boolean;
}

export const getCapabilities = () => apiGet<CapabilitiesRef>('/reference/capabilities');
export const getEquipmentTypes = () => apiGet<EquipmentTypeRef[]>('/reference/equipment-types');
export const getEquipment = () => apiGet<EquipmentRef[]>('/reference/equipment');
export const getRateCards = () => apiGet<RateCardRef[]>('/reference/rate-cards');
export const getRentals = () => apiGet<RentalRef[]>('/reference/rentals');
export const getCustomers = () => apiGet<CustomerRef[]>('/reference/customers');
export const getProjectSites = () => apiGet<ProjectSiteRef[]>('/reference/project-sites');
