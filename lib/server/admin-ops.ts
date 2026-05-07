import 'server-only'

const TABLES = {
  APP_JOBS: 'app_jobs',
  EXTERNAL_EVENT_INTEGRATIONS: 'external_event_integrations',
  BUILDER_TICKETING_CONNECTIONS: 'builder_ticketing_connections',
  EVENT_WEBHOOK_EVENTS: 'event_webhook_events',
  KICKBACK_DISPUTES: 'kickback_disputes',
  VENDOR_BOOKINGS: 'vendor_bookings',
  VENUE_BOOKINGS: 'venue_bookings',
  VENUES: 'venues',
  VENDOR_PROFILES: 'vendor_profiles',
} as const

type AdminOpsRow = Record<string, unknown>
type QueryError = { message?: string } | null
type QueryResult<T extends AdminOpsRow> = { data: T[] | null; error: QueryError }
type FilterValue = string | number | boolean | null

type AdminOpsQueryBuilder<T extends AdminOpsRow = AdminOpsRow> = PromiseLike<QueryResult<T>> & {
  select(columns: string): AdminOpsQueryBuilder<T>
  eq(column: string, value: FilterValue): AdminOpsQueryBuilder<T>
  gt(column: string, value: FilterValue): AdminOpsQueryBuilder<T>
  lt(column: string, value: FilterValue): AdminOpsQueryBuilder<T>
  or(filters: string): AdminOpsQueryBuilder<T>
  order(column: string, options: { ascending: boolean }): AdminOpsQueryBuilder<T>
  limit(count: number): AdminOpsQueryBuilder<T>
}

export type AdminOpsClient = {
  from(table: string): AdminOpsQueryBuilder
}

async function safeQuery<T extends AdminOpsRow = AdminOpsRow>(
  label: string,
  query: PromiseLike<QueryResult<T>>
): Promise<T[]> {
  try {
    const { data, error } = await query
    if (error) {
      console.error(`[admin.ops] ${label} unavailable`, error)
      return []
    }
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error(`[admin.ops] ${label} query failed`, error)
    return []
  }
}

export async function getAdminOpsData(admin: AdminOpsClient) {
  const now = Date.now()
  const stalledVendorBookingCutoff = new Date(now - 48 * 60 * 60 * 1000).toISOString()
  const vendorNoResponseCutoff = new Date(now - 72 * 60 * 60 * 1000).toISOString()
  const uncontactedVendorCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [
    jobs,
    integrations,
    ticketingConnections,
    webhookEvents,
    disputes,
    refundBookings,
    pendingVendorBookings,
    pendingVenueBookings,
    unpublishedVenues,
    stalledVendorBookings,
    vendorBookingsNoResponse,
    uncontactedVendors,
  ] = await Promise.all([
    safeQuery(
      'jobs',
      admin
        .from(TABLES.APP_JOBS)
        .select('id, job_type, status, attempts, max_attempts, error, result, scheduled_at, created_at, completed_at')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'integrations',
      admin
        .from(TABLES.EXTERNAL_EVENT_INTEGRATIONS)
        .select('id, event_id, platform, sync_status, last_sync_at, last_sync_error, sync_error, external_event_id, updated_at')
        .order('updated_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'ticketing connections',
      admin
        .from(TABLES.BUILDER_TICKETING_CONNECTIONS)
        .select('id, builder_id, platform, status, webhook_url, last_connected_at, last_error, updated_at')
        .order('updated_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'webhook events',
      admin
        .from(TABLES.EVENT_WEBHOOK_EVENTS)
        .select('id, platform, event_id, integration_id, webhook_type, processed_at, processing_error, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'disputes',
      admin
        .from(TABLES.KICKBACK_DISPUTES)
        .select('id, agreement_id, dispute_type, status, created_at, resolved_at')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'refund bookings',
      admin
        .from(TABLES.VENDOR_BOOKINGS)
        .select('id, event_id, vendor_id, status, payment_status, refund_amount, cancellation_reason, cancelled_at, created_at')
        .or('payment_status.eq.refunded,refund_amount.gt.0,status.eq.cancelled')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'pending vendor bookings',
      admin
        .from(TABLES.VENDOR_BOOKINGS)
        .select('id, event_id, vendor_id, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'pending venue bookings',
      admin
        .from(TABLES.VENUE_BOOKINGS)
        .select('id, event_id, venue_id, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'unpublished venues',
      admin
        .from(TABLES.VENUES)
        .select('id, venue_name, owner_id, is_published, created_at')
        .eq('is_published', false)
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'stalled vendor bookings',
      admin
        .from(TABLES.VENDOR_BOOKINGS)
        .select('id, event_id, vendor_id, status, created_at')
        .eq('status', 'pending')
        .lt('created_at', stalledVendorBookingCutoff)
        .order('created_at', { ascending: true })
        .limit(30)
    ),
    safeQuery(
      'vendor bookings no response',
      admin
        .from(TABLES.VENDOR_BOOKINGS)
        .select('id, event_id, vendor_id, status, created_at, updated_at')
        .eq('status', 'pending')
        .lt('updated_at', vendorNoResponseCutoff)
        .order('updated_at', { ascending: true })
        .limit(30)
    ),
    safeQuery(
      'uncontacted vendors',
      admin
        .from(TABLES.VENDOR_PROFILES)
        .select('id, name, service_type, created_at')
        .eq('total_bookings', 0)
        .gt('created_at', uncontactedVendorCutoff)
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(30)
    ),
  ])

  const jobRows = jobs as Array<{ status?: string | null }>
  const integrationRows = integrations as Array<{ sync_status?: string | null; sync_error?: string | null; last_sync_error?: string | null }>
  const webhookRows = webhookEvents as Array<{ processing_error?: string | null; processed_at?: string | null }>
  const disputeRows = disputes as Array<{ status?: string | null }>

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      queuedJobs: jobRows.filter((job) => job.status === 'pending').length,
      deadJobs: jobRows.filter((job) => job.status === 'dead').length,
      integrationErrors: integrationRows.filter((row) => row.sync_status === 'failed' || row.sync_error || row.last_sync_error).length,
      webhookErrors: webhookRows.filter((row) => row.processing_error || !row.processed_at).length,
      openDisputes: disputeRows.filter((row) => row.status === 'open' || row.status === 'under_review' || row.status === 'escalated').length,
      refundCases: (refundBookings as unknown[]).length,
      pendingVendorBookings: (pendingVendorBookings as unknown[]).length,
      pendingVenueBookings: (pendingVenueBookings as unknown[]).length,
      unpublishedVenues: (unpublishedVenues as unknown[]).length,
      stalledVendorBookings: (stalledVendorBookings as unknown[]).length,
      vendorBookingsNoResponse: (vendorBookingsNoResponse as unknown[]).length,
      uncontactedVendors: (uncontactedVendors as unknown[]).length,
    },
    jobs,
    integrations,
    ticketingConnections,
    webhookEvents,
    disputes,
    refundBookings,
    stalled_vendor_bookings: stalledVendorBookings,
    vendor_bookings_no_response: vendorBookingsNoResponse,
    uncontacted_vendors: uncontactedVendors,
    marketplace: {
      pendingVendorBookings,
      pendingVenueBookings,
      unpublishedVenues,
    },
  }
}
