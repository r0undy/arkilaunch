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
  rateType: string;
  rateValue: string;
  currency: string;
}
export interface RentalRef {
  id: string;
  customerId: string;
  projectSiteId: string;
  status: string;
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

export const getEquipmentTypes = () => apiGet<EquipmentTypeRef[]>('/reference/equipment-types');
export const getEquipment = () => apiGet<EquipmentRef[]>('/reference/equipment');
export const getRateCards = () => apiGet<RateCardRef[]>('/reference/rate-cards');
export const getRentals = () => apiGet<RentalRef[]>('/reference/rentals');
export const getCustomers = () => apiGet<CustomerRef[]>('/reference/customers');
export const getProjectSites = () => apiGet<ProjectSiteRef[]>('/reference/project-sites');
