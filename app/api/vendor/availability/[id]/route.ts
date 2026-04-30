import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const updateAvailabilitySchema = z.object({
  status: z.enum(['available', 'blocked', 'tentative']),
  notes: z.string().max(500).optional().nullable(),
})

/**
 * Verifies that the signed-in user owns an availability row.
 *
 * @param supabase - Request-scoped Supabase client.
 * @param id - Availability row id.
 * @returns Availability row or error response.
 */
async function requireOwnedAvailability(supabase: ReturnType<typeof createClient>, id: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data, error } = await supabase
    .from('vendor_availability')
    .select('*, vendor_profiles!inner(user_id)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[vendor.availability.detail] Lookup failed', error)
    return { ok: false as const, response: NextResponse.json({ error: 'Failed to verify availability' }, { status: 500 }) }
  }

  if (!data) {
    return { ok: false as const, response: NextResponse.json({ error: 'Availability row not found' }, { status: 404 }) }
  }

  const row = data as { vendor_id: string; date: string; booking_id: string | null; vendor_profiles?: { user_id?: string } }
  if (row.vendor_profiles?.user_id !== user.id) {
    return { ok: false as const, response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) }
  }

  return { ok: true as const, availability: row }
}

/**
 * Updates a vendor availability date status.
 *
 * @route PUT /api/vendor/availability/{id}
 * @auth Required - vendor owner only.
 *
 * @param request - Update payload.
 * @param params - Availability row id.
 * @returns Updated availability row.
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) return NextResponse.json({ error: 'Invalid availability id' }, { status: 400 })

    const parsedBody = updateAvailabilitySchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid availability payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const ownership = await requireOwnedAvailability(supabase, parsedId.data)
    if (!ownership.ok) return ownership.response

    if (ownership.availability.booking_id) {
      return NextResponse.json(
        { error: 'Booking-controlled availability can only change when the booking changes' },
        { status: 409 }
      )
    }

    const { data, error } = await supabase
      .from('vendor_availability')
      .update({
        status: parsedBody.data.status,
        notes: parsedBody.data.notes || null,
        booking_id: parsedBody.data.status === 'available' ? null : ownership.availability.booking_id,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', parsedId.data)
      .select('*')
      .single()

    if (error) {
      console.error('[vendor.availability.detail] Update failed', error)
      return NextResponse.json({ error: 'Failed to update availability' }, { status: 500 })
    }

    return NextResponse.json({ availability: data })
  } catch (error) {
    console.error('[vendor.availability.detail] Unexpected PUT error', error)
    return NextResponse.json({ error: 'Failed to update availability' }, { status: 500 })
  }
}
