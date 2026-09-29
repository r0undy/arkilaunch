// Maps the logical model ids used at call sites to the real Azure DI request.
export type ModelRequest =
  | { kind: 'model'; modelId: string }
  | { kind: 'query-fields'; modelId: string; queryFields: string[] };

// prebuilt-idDocument doesn't cover PH SEC/TIN/DTI papers: prebuilt-layout + queryFields (max 20).
const KYC_QUERY_FIELDS = [
  'SecNumber',
  'Tin',
  'BusinessNameNumber',
  'CompanyName',
  'RegisteredAddress',
  'RegistrationDate',
];

// One read serves every PH primary ID; IdNumber is validated per card type afterwards.
const NATIONAL_ID_QUERY_FIELDS = [
  'FirstName',
  'MiddleName',
  'LastName',
  'IdNumber',
  'DateOfBirth',
  'Sex',
  'Address',
];

// EDTR uses layout's TABLE output: queryFields read the letterhead as Operator at 0.883, confidently wrong.
export const EDTR_MODEL_ID = 'arkilaunch-edtr-layout-table';

export const KYC_MODEL_ID = 'arkilaunch-kyc-layout-query';

export const NATIONAL_ID_MODEL_ID = 'arkilaunch-national-id-layout-query';

export function resolveModelRequest(modelId: string): ModelRequest {
  if (modelId === KYC_MODEL_ID) {
    return { kind: 'query-fields', modelId: 'prebuilt-layout', queryFields: KYC_QUERY_FIELDS };
  }
  if (modelId === NATIONAL_ID_MODEL_ID) {
    return {
      kind: 'query-fields',
      modelId: 'prebuilt-layout',
      queryFields: NATIONAL_ID_QUERY_FIELDS,
    };
  }
  if (modelId === EDTR_MODEL_ID) {
    return { kind: 'model', modelId: 'prebuilt-layout' };
  }
  // Any other id passes through as a custom model; an untrained one 404s into a hard failure.
  return { kind: 'model', modelId };
}

export const QUERY_FIELD_TO_PORT_KEY: Record<string, string> = {
  SecNumber: 'sec_number',
  Tin: 'tin',
  CompanyName: 'company_name',
  RegisteredAddress: 'registered_address',
  RegistrationDate: 'registration_date',
  FirstName: 'first_name',
  MiddleName: 'middle_name',
  LastName: 'last_name',
  BusinessNameNumber: 'dti_number',
  IdNumber: 'id_number',
  DateOfBirth: 'birth_date',
  Sex: 'sex',
  Address: 'address',
};
