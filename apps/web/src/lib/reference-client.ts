import { apiGet } from './api-client.js';

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
  equipmentId: string | null;
  rateType: string;
  rateValue: string;
  currency: string;
}
export interface RentalRef {
  id: string;
  code: string;
  customerId: string;
  projectSiteId: string;
  status: string;
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

// With the OCR pipeline on, a paper scan must not carry transcribed hours (422 line_items_not_accepted).
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
