export type CHIType =
  | 'per_verified_attendee'
  | 'fixed_threshold'
  | 'fixed_flat'
  | 'base_plus_per_attendee'
  | 'manual_venue_approved'

export type CHIVerificationSource =
  | 'ticketing_api'
  | 'ticketing_webhook'
  | 'csv_upload'
  | 'screenshot_ocr'

export type CHICalculationBasis =
  | 'verified_attendance'
  | 'fixed_threshold_met'
  | 'fixed_flat'
  | 'base_plus_verified_attendance'
  | 'manual_venue_approved'

export type CHIAgreementInput = {
  agreementType: CHIType
  perHeadRateCents?: number
  fixedAmountCents?: number
  thresholdAttendees?: number
  baseAmountCents?: number
  payoutCapCents?: number
  payoutFloorCents?: number
  venueApproved: boolean
  approvedAt: string
  approvedByVenueUserId: string
}

export type CHISettlementInput = {
  agreement: CHIAgreementInput
  verifiedAttendees: number
  verificationSource: CHIVerificationSource
  verificationSourceId?: string
}

export type CHISettlementResult = {
  organizerPayoutCents: number
  calculationBasis: CHICalculationBasis
  appliedFloor: boolean
  appliedCap: boolean
  complianceFlags: string[]
}
