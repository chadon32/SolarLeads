export const AI_QUALIFIED_SOLAR_LEADS_TABLE = "ai_qualified_solar_leads";

export const monthlyElectricBillRanges = [
  "under_150",
  "150_250",
  "250_400",
  "400_600",
  "over_600",
  "unknown",
] as const;

export const solarTimelineOptions = [
  "immediately",
  "1_3_months",
  "3_6_months",
  "6_12_months",
  "researching",
] as const;

export const preferredContactMethods = ["phone", "text", "email"] as const;

export const leadTemperatureInternalValues = [
  "Cold Lead",
  "Warm Lead",
  "Qualified Lead",
  "Hot Lead",
  "Premium Lead",
] as const;

export const exclusiveStatusValues = [
  "available",
  "reserved",
  "claimed",
  "released",
  "expired",
] as const;

export type MonthlyElectricBillRange =
  (typeof monthlyElectricBillRanges)[number];

export type SolarTimeline = (typeof solarTimelineOptions)[number];

export type PreferredContactMethod = (typeof preferredContactMethods)[number];

export type LeadTemperatureInternal =
  (typeof leadTemperatureInternalValues)[number];

export type ExclusiveStatus = (typeof exclusiveStatusValues)[number];

export type AiQualifiedSolarLeadRow = {
  lead_id: string;
  report_id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string;
  owns_home: boolean | null;
  monthly_electric_bill_range: MonthlyElectricBillRange | null;
  solar_timeline: SolarTimeline | null;
  preferred_contact_method: PreferredContactMethod | null;
  roof_suitability_score: number | null;
  solar_readiness_score: number | null;
  lead_score_internal: number | null;
  lead_temperature_internal: LeadTemperatureInternal | null;
  panel_count: number | null;
  system_size_kw: number | null;
  annual_savings: number | null;
  monthly_savings: number | null;
  energy_offset: number | null;
  solar_ready_area_sqft: number | null;
  report_pdf_url: string | null;
  exclusive_status: ExclusiveStatus;
  installer_claimed_by: string | null;
  created_at: string;
};

export type AiQualifiedSolarLeadInsert = {
  lead_id?: string;
  report_id?: string;
  name: string;
  email: string;
  phone?: string | null;
  address: string;
  owns_home?: boolean | null;
  monthly_electric_bill_range?: MonthlyElectricBillRange | null;
  solar_timeline?: SolarTimeline | null;
  preferred_contact_method?: PreferredContactMethod | null;
  roof_suitability_score?: number | null;
  solar_readiness_score?: number | null;
  lead_score_internal?: number | null;
  lead_temperature_internal?: LeadTemperatureInternal | null;
  panel_count?: number | null;
  system_size_kw?: number | null;
  annual_savings?: number | null;
  monthly_savings?: number | null;
  energy_offset?: number | null;
  solar_ready_area_sqft?: number | null;
  report_pdf_url?: string | null;
  exclusive_status?: ExclusiveStatus;
  installer_claimed_by?: string | null;
  created_at?: string;
};

export type AiQualifiedSolarLeadUpdate =
  Partial<Omit<AiQualifiedSolarLeadInsert, "lead_id" | "report_id">>;

export type AiQualifiedSolarLead = {
  leadId: string;
  reportId: string;
  name: string;
  email: string;
  phone: string | null;
  address: string;
  ownsHome: boolean | null;
  monthlyElectricBillRange: MonthlyElectricBillRange | null;
  solarTimeline: SolarTimeline | null;
  preferredContactMethod: PreferredContactMethod | null;
  roofSuitabilityScore: number | null;
  solarReadinessScore: number | null;
  leadScoreInternal: number | null;
  leadTemperatureInternal: LeadTemperatureInternal | null;
  panelCount: number | null;
  systemSizeKw: number | null;
  annualSavings: number | null;
  monthlySavings: number | null;
  energyOffset: number | null;
  solarReadyAreaSqft: number | null;
  reportPdfUrl: string | null;
  exclusiveStatus: ExclusiveStatus;
  installerClaimedBy: string | null;
  createdAt: string;
};

export function toAiQualifiedSolarLead(
  row: AiQualifiedSolarLeadRow
): AiQualifiedSolarLead {
  return {
    leadId: row.lead_id,
    reportId: row.report_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    ownsHome: row.owns_home,
    monthlyElectricBillRange: row.monthly_electric_bill_range,
    solarTimeline: row.solar_timeline,
    preferredContactMethod: row.preferred_contact_method,
    roofSuitabilityScore: row.roof_suitability_score,
    solarReadinessScore: row.solar_readiness_score,
    leadScoreInternal: row.lead_score_internal,
    leadTemperatureInternal: row.lead_temperature_internal,
    panelCount: row.panel_count,
    systemSizeKw: row.system_size_kw,
    annualSavings: row.annual_savings,
    monthlySavings: row.monthly_savings,
    energyOffset: row.energy_offset,
    solarReadyAreaSqft: row.solar_ready_area_sqft,
    reportPdfUrl: row.report_pdf_url,
    exclusiveStatus: row.exclusive_status,
    installerClaimedBy: row.installer_claimed_by,
    createdAt: row.created_at,
  };
}
