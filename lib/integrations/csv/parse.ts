import 'server-only'

import Papa from 'papaparse'
import {
  classifyTicketTier,
  majorAmountFromCents,
  normalizeCurrency,
  type TicketTierCategory,
} from '@/lib/server/ticket-normalization'

export type CsvImportKind = 'attendees' | 'sales'
export type CsvImportSource = 'posh' | 'eventbrite' | 'luma' | 'partiful' | 'other'
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export type ConfidenceEntry = {
  confidence: ConfidenceLevel
  source: string
}

export type FieldConfidence = Record<string, ConfidenceEntry>

export type CsvRow = Record<string, string>

export type AttendeeField =
  | 'external_attendee_id'
  | 'full_name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'ticket_type'
  | 'order_id'
  | 'checked_in'
  | 'check_in_time'
  | 'ticket_price'

export type SalesField =
  | 'order_id'
  | 'buyer_name'
  | 'buyer_email'
  | 'ticket_quantity'
  | 'ticket_type'
  | 'ticket_price'
  | 'total_amount'
  | 'fees'
  | 'currency'
  | 'discount_code'
  | 'is_refund'
  | 'purchase_timestamp'

export type CsvField = AttendeeField | SalesField
export type CsvMapping = Partial<Record<CsvField, string>>

export type CsvMappingResult = {
  mapping: CsvMapping
  candidates: Partial<Record<CsvField, string[]>>
  requiredFields: CsvField[]
  missingRequired: CsvField[]
  ambiguousFields: CsvField[]
  needsMapping: boolean
}

export type ParsedCsv = {
  headers: string[]
  rows: CsvRow[]
  previewRows: CsvRow[]
  mapping: CsvMappingResult
}

export type NormalizedAttendeeImport = {
  external_attendee_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  ticket_type: string | null
  ticket_class: string | null
  ticket_tier_name: string | null
  ticket_tier_category: TicketTierCategory
  order_id: string | null
  checked_in: boolean
  check_in_time: string | null
  check_in_method: string | null
  ticket_price: number | null
  ticket_price_cents: number | null
  raw_ticket_class_id: string | null
  raw_data: Record<string, unknown>
  field_confidence: FieldConfidence
}

export type NormalizedSaleImport = {
  order_id: string
  platform: CsvImportSource
  ticket_buyer_name: string | null
  ticket_buyer_email: string | null
  ticket_quantity: number
  ticket_type: string | null
  ticket_tier_name: string | null
  ticket_tier_category: TicketTierCategory
  ticket_price: number | null
  ticket_price_cents: number | null
  total_amount: number
  total_amount_cents: number
  fees: number
  fees_cents: number
  currency: string
  discount_code: string | null
  is_refund: boolean
  purchase_timestamp: string | null
  raw_ticket_class_id: string | null
  sales_channel: string
  source: 'csv_import'
  received_at: string
  gross_cents: number
  tier_name: string
  raw_data: Record<string, unknown>
  field_confidence: FieldConfidence
}

const attendeeFieldPatterns: Record<AttendeeField, RegExp[]> = {
  external_attendee_id: [/^attendee\s*id$/i, /^guest\s*id$/i, /^id$/i, /^ticket\s*id$/i],
  full_name: [/^(full\s*)?name$/i, /^guest\s*name$/i, /^attendee\s*name$/i],
  first_name: [/^first\s*name$/i, /^firstname$/i, /^given\s*name$/i],
  last_name: [/^last\s*name$/i, /^lastname$/i, /^surname$/i, /^family\s*name$/i],
  email: [/^e-?mail$/i, /^email\s*address$/i, /^guest\s*email$/i, /^attendee\s*email$/i],
  ticket_type: [/^ticket\s*(type|class|tier|name)$/i, /^tier$/i, /^registration\s*type$/i],
  order_id: [/^order\s*id$/i, /^confirmation\s*(number|id)$/i, /^transaction\s*id$/i],
  checked_in: [/^checked\s*in\??$/i, /^check[-\s]*in\s*status$/i, /^status$/i, /^attended$/i, /^scanned$/i],
  check_in_time: [/^check[-\s]*in\s*(time|date|at)$/i, /^checked\s*in\s*at$/i, /^scan\s*time$/i],
  ticket_price: [/^ticket\s*price$/i, /^price$/i, /^gross$/i, /^amount$/i],
}

const salesFieldPatterns: Record<SalesField, RegExp[]> = {
  order_id: [/^order\s*id$/i, /^confirmation\s*(number|id)$/i, /^transaction\s*id$/i, /^purchase\s*id$/i],
  buyer_name: [/^buyer\s*name$/i, /^purchaser\s*name$/i, /^customer\s*name$/i, /^(full\s*)?name$/i],
  buyer_email: [/^buyer\s*email$/i, /^purchaser\s*email$/i, /^customer\s*email$/i, /^e-?mail$/i],
  ticket_quantity: [/^quantity$/i, /^qty$/i, /^tickets?$/i, /^ticket\s*quantity$/i, /^count$/i],
  ticket_type: [/^ticket\s*(type|class|tier|name)$/i, /^tier$/i, /^item$/i],
  ticket_price: [/^ticket\s*price$/i, /^unit\s*price$/i, /^price$/i],
  total_amount: [/^total$/i, /^gross$/i, /^gross\s*sales$/i, /^amount$/i, /^paid$/i, /^order\s*total$/i],
  fees: [/^fees?$/i, /^platform\s*fees?$/i, /^service\s*fees?$/i, /^processing\s*fees?$/i],
  currency: [/^currency$/i],
  discount_code: [/^discount\s*code$/i, /^promo\s*code$/i, /^code$/i],
  is_refund: [/^refund(ed)?$/i, /^is\s*refund$/i, /^status$/i],
  purchase_timestamp: [/^purchase(d)?\s*(time|date|at)$/i, /^created$/i, /^order\s*date$/i, /^date$/i],
}

const attendeeRequiredFields: CsvField[] = ['email', 'full_name']
const salesRequiredFields: CsvField[] = ['order_id', 'total_amount']

export function parseCsvImport(text: string, kind: CsvImportKind, mappingOverride?: CsvMapping): ParsedCsv {
  const parsed = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => (typeof value === 'string' ? value.trim() : value),
  })

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(parsed.errors[0]?.message ?? 'Could not parse CSV')
  }

  const rows = parsed.data
    .map((row) => normalizeCsvRow(row))
    .filter((row) => Object.values(row).some((value) => value.trim()))
  const headers = extractHeaders(parsed.meta.fields, rows)
  const mapping = detectCsvMapping(headers, kind, mappingOverride)

  return {
    headers,
    rows,
    previewRows: rows.slice(0, 5),
    mapping,
  }
}

export function detectCsvMapping(
  headers: string[],
  kind: CsvImportKind,
  mappingOverride?: CsvMapping
): CsvMappingResult {
  const fieldPatterns = kind === 'attendees' ? attendeeFieldPatterns : salesFieldPatterns
  const requiredFields = kind === 'attendees' ? attendeeRequiredFields : salesRequiredFields
  const candidates: Partial<Record<CsvField, string[]>> = {}
  const mapping: CsvMapping = { ...(mappingOverride ?? {}) }
  const ambiguousFields: CsvField[] = []

  Object.entries(fieldPatterns).forEach(([field, patterns]) => {
    const typedField = field as CsvField
    const matches = headers.filter((header) => patterns.some((pattern) => pattern.test(normalizeHeader(header))))
    if (matches.length > 0) candidates[typedField] = matches
    if (mapping[typedField]) return
    if (matches.length === 1) {
      mapping[typedField] = matches[0]
    } else if (matches.length > 1) {
      ambiguousFields.push(typedField)
    }
  })

  const missingRequired = kind === 'attendees'
    ? !mapping.email && !mapping.full_name && (!mapping.first_name || !mapping.last_name)
      ? attendeeRequiredFields
      : []
    : requiredFields.filter((field) => !mapping[field])
  const needsMapping = ambiguousFields.length > 0 || missingRequired.length > 0

  return {
    mapping,
    candidates,
    requiredFields,
    missingRequired,
    ambiguousFields,
    needsMapping,
  }
}

export function normalizeAttendeeRows(input: {
  rows: CsvRow[]
  mapping: CsvMapping
  source: CsvImportSource
}) {
  return input.rows.flatMap((row, index) => {
    const fullName = readMapped(row, input.mapping.full_name)
    const split = splitName(fullName)
    const firstName = readMapped(row, input.mapping.first_name) || split.firstName
    const lastName = readMapped(row, input.mapping.last_name) || split.lastName
    const email = readMapped(row, input.mapping.email)
    const ticketType = readMapped(row, input.mapping.ticket_type) || 'General Admission'
    const ticketPriceCents = parseMoneyCents(readMapped(row, input.mapping.ticket_price))
    const externalId =
      readMapped(row, input.mapping.external_attendee_id) ||
      readMapped(row, input.mapping.order_id) ||
      email ||
      `${input.source}:attendee:${index + 1}`
    const checkedIn = parseBooleanish(readMapped(row, input.mapping.checked_in))
    const checkInTime = normalizeDateTime(readMapped(row, input.mapping.check_in_time))

    if (!email && !firstName && !lastName && !externalId) return []

    return [{
      external_attendee_id: `${input.source}:${externalId}`,
      first_name: firstName,
      last_name: lastName,
      email,
      ticket_type: ticketType,
      ticket_class: null,
      ticket_tier_name: ticketType,
      ticket_tier_category: classifyTicketTier(ticketType, ticketPriceCents),
      order_id: readMapped(row, input.mapping.order_id) || null,
      checked_in: checkedIn,
      check_in_time: checkedIn ? checkInTime : null,
      check_in_method: checkedIn ? 'csv_import' : null,
      ticket_price: majorAmountFromCents(ticketPriceCents),
      ticket_price_cents: ticketPriceCents,
      raw_ticket_class_id: null,
      raw_data: row,
      field_confidence: buildFieldConfidence([
        'external_attendee_id',
        'first_name',
        'last_name',
        'email',
        'ticket_type',
        'checked_in',
        'check_in_time',
        'ticket_price',
      ], 'high', 'csv_import'),
    } satisfies NormalizedAttendeeImport]
  })
}

export function normalizeSalesRows(input: {
  rows: CsvRow[]
  mapping: CsvMapping
  source: CsvImportSource
}) {
  return input.rows.flatMap((row, index) => {
    const totalAmountCents = parseMoneyCents(readMapped(row, input.mapping.total_amount))
    const ticketQuantity = parseInteger(readMapped(row, input.mapping.ticket_quantity)) ?? 1
    const ticketType = readMapped(row, input.mapping.ticket_type) || 'General Admission'
    const ticketPriceCents =
      parseMoneyCents(readMapped(row, input.mapping.ticket_price)) ??
      (totalAmountCents !== null && ticketQuantity > 0 ? Math.round(Math.abs(totalAmountCents) / ticketQuantity) : null)
    const feesCents = parseMoneyCents(readMapped(row, input.mapping.fees)) ?? 0
    const isRefund = parseRefund(readMapped(row, input.mapping.is_refund), totalAmountCents)
    const orderId = readMapped(row, input.mapping.order_id) || `${input.source}:csv:${index + 1}`
    const signedTotalCents = isRefund ? -Math.abs(totalAmountCents ?? 0) : totalAmountCents ?? 0

    if (totalAmountCents === null && !readMapped(row, input.mapping.order_id)) return []

    return [{
      order_id: `${input.source}:${orderId}${isRefund ? ':refund' : ''}`,
      platform: input.source,
      ticket_buyer_name: readMapped(row, input.mapping.buyer_name) || null,
      ticket_buyer_email: readMapped(row, input.mapping.buyer_email) || null,
      ticket_quantity: isRefund ? -Math.abs(ticketQuantity) : Math.max(ticketQuantity, 1),
      ticket_type: ticketType,
      ticket_tier_name: ticketType,
      ticket_tier_category: classifyTicketTier(ticketType, ticketPriceCents),
      ticket_price: majorAmountFromCents(ticketPriceCents),
      ticket_price_cents: ticketPriceCents,
      total_amount: majorAmountFromCents(signedTotalCents) ?? 0,
      total_amount_cents: signedTotalCents,
      fees: majorAmountFromCents(feesCents) ?? 0,
      fees_cents: feesCents,
      currency: normalizeCurrency(readMapped(row, input.mapping.currency)),
      discount_code: readMapped(row, input.mapping.discount_code) || null,
      is_refund: isRefund,
      purchase_timestamp: normalizeDateTime(readMapped(row, input.mapping.purchase_timestamp)),
      raw_ticket_class_id: null,
      sales_channel: `${input.source}_csv_import`,
      source: 'csv_import',
      received_at: new Date().toISOString(),
      gross_cents: Math.max(signedTotalCents, 0),
      tier_name: ticketType,
      raw_data: row,
      field_confidence: buildFieldConfidence([
        'order_id',
        'ticket_buyer_name',
        'ticket_buyer_email',
        'ticket_quantity',
        'ticket_type',
        'ticket_price',
        'total_amount',
        'fees',
        'currency',
        'is_refund',
        'purchase_timestamp',
      ], 'high', 'csv_import'),
    } satisfies NormalizedSaleImport]
  })
}

export function buildFieldConfidence(fields: string[], confidence: ConfidenceLevel, source: string): FieldConfidence {
  return Object.fromEntries(fields.map((field) => [field, { confidence, source }]))
}

export function getMissingReportFields(input: {
  event: Record<string, unknown>
  attendeeCount: number
  salesCount: number
  screenshotFields?: Record<string, unknown> | null
}) {
  const missing: string[] = []
  if (!input.event.event_name) missing.push('event_name')
  if (!input.event.event_date) missing.push('event_date')
  if (!input.event.expected_attendance) missing.push('expected_attendance')
  if (input.attendeeCount === 0 && !input.screenshotFields?.checked_in_count) missing.push('checked_in_count')
  if (input.salesCount === 0 && !input.screenshotFields?.tickets_sold) missing.push('tickets_sold')
  if (input.salesCount === 0 && !input.screenshotFields?.gross_revenue_cents) missing.push('gross_revenue_cents')
  return missing
}

function normalizeCsvRow(row: Record<string, unknown>): CsvRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.trim(), value == null ? '' : String(value).trim()])
  )
}

function extractHeaders(fields: string[] | undefined, rows: CsvRow[]) {
  const fromFields = (fields ?? []).map((field) => field.trim()).filter(Boolean)
  if (fromFields.length > 0) return fromFields
  return [...new Set(rows.flatMap((row) => Object.keys(row)))]
}

function normalizeHeader(value: string) {
  return value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function readMapped(row: CsvRow, header: string | undefined) {
  if (!header) return ''
  return row[header] ?? row[normalizeHeader(header)] ?? ''
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  }
}

function parseMoneyCents(value: string) {
  if (!value) return null
  const normalized = value.replace(/[$,]/g, '').trim()
  if (!normalized || !Number.isFinite(Number(normalized))) return null
  return Math.round(Number(normalized) * 100)
}

function parseInteger(value: string) {
  if (!value) return null
  const normalized = value.replace(/[,]/g, '').trim()
  if (!normalized || !Number.isFinite(Number(normalized))) return null
  return Math.round(Number(normalized))
}

function parseBooleanish(value: string) {
  const normalized = value.trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'checked in', 'checked-in', 'attended', 'scanned'].includes(normalized)
}

function parseRefund(value: string, totalAmountCents: number | null) {
  const normalized = value.trim().toLowerCase()
  if (totalAmountCents !== null && totalAmountCents < 0) return true
  return /\b(refund|refunded|cancel|cancelled|canceled|void|returned|yes|true)\b/i.test(normalized)
}

function normalizeDateTime(value: string) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toISOString()
}
