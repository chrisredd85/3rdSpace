import 'server-only'

async function safeQuery<T extends Record<string, any> = Record<string, any>>(
  label: string,
  query: PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const { data, error } = await query
  if (error) {
    console.warn(`[admin.ops] ${label} unavailable`, error)
    return []
  }
  return Array.isArray(data) ? data : []
}

export async function getAdminOpsData(admin: any) {
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
  ] = await Promise.all([
    safeQuery(
      'jobs',
      admin
        .from('app_jobs')
        .select('id, job_type, status, attempts, max_attempts, error, result, scheduled_at, created_at, completed_at')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'integrations',
      admin
        .from('external_event_integrations')
        .select('id, event_id, platform, sync_status, last_sync_at, last_sync_error, sync_error, external_event_id, updated_at')
        .order('updated_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'ticketing connections',
      admin
        .from('builder_ticketing_connections')
        .select('id, builder_id, platform, status, webhook_url, last_connected_at, last_error, updated_at')
        .order('updated_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'webhook events',
      admin
        .from('event_webhook_events')
        .select('id, platform, event_id, integration_id, webhook_type, processed_at, processing_error, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'disputes',
      admin
        .from('kickback_disputes')
        .select('id, agreement_id, dispute_type, status, created_at, resolved_at')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'refund bookings',
      admin
        .from('vendor_bookings')
        .select('id, event_id, vendor_id, status, payment_status, refund_amount, cancellation_reason, cancelled_at, created_at')
        .or('payment_status.eq.refunded,refund_amount.gt.0,status.eq.cancelled')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'pending vendor bookings',
      admin
        .from('vendor_bookings')
        .select('id, event_id, vendor_id, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'pending venue bookings',
      admin
        .from('venue_bookings')
        .select('id, event_id, venue_id, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'unpublished venues',
      admin
        .from('venues')
        .select('id, venue_name, owner_id, is_published, created_at')
        .eq('is_published', false)
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
    },
    jobs,
    integrations,
    ticketingConnections,
    webhookEvents,
    disputes,
    refundBookings,
    marketplace: {
      pendingVendorBookings,
      pendingVenueBookings,
      unpublishedVenues,
    },
  }
}
