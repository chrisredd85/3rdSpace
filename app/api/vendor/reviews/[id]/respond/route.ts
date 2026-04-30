import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const responseSchema = z.object({
  response: z.string().trim().min(1).max(1200),
})

/**
 * Saves a public vendor response to a review.
 *
 * Only the owner of the reviewed vendor profile can respond. The response is
 * stored in the new vendor_response fields and mirrored into the legacy
 * response_text/responded_at fields so older UI still reads the response.
 *
 * @route PUT /api/vendor/reviews/{id}/respond
 * @auth Required - vendor owner only.
 *
 * @param request - Response update request.
 * @param params - Review id route params.
 * @returns Updated review response fields.
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid review id' }, { status: 400 })
    }

    const parsedBody = responseSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: parsedBody.error.errors[0]?.message || 'Invalid response payload' },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: review, error: reviewError } = await supabase
      .from('reviews')
      .select('id, vendor_id, status')
      .eq('id', parsedId.data)
      .maybeSingle()

    if (reviewError) {
      console.error('[vendor.reviews.respond] Review lookup failed', reviewError)
      return NextResponse.json({ error: 'Failed to load review' }, { status: 500 })
    }

    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }

    const reviewRow = review as { vendor_id: string | null; status?: string | null }
    if (!reviewRow.vendor_id) {
      return NextResponse.json({ error: 'Review is not linked to a vendor' }, { status: 400 })
    }

    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id, user_id')
      .eq('id', reviewRow.vendor_id)
      .maybeSingle()

    if (vendorError || !vendor) {
      console.error('[vendor.reviews.respond] Vendor lookup failed', vendorError)
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    if ((vendor as { user_id: string }).user_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized to respond to this review' }, { status: 403 })
    }

    const responseDate = new Date().toISOString()
    const { data: updated, error: updateError } = await supabase
      .from('reviews')
      .update({
        vendor_response: parsedBody.data.response,
        response_date: responseDate,
        response_text: parsedBody.data.response,
        responded_at: responseDate,
        updated_at: responseDate,
      } as never)
      .eq('id', parsedId.data)
      .select('id, vendor_response, response_date, response_text, responded_at')
      .single()

    if (updateError) {
      console.error('[vendor.reviews.respond] Response update failed', updateError)
      return NextResponse.json({ error: 'Failed to save response' }, { status: 500 })
    }

    return NextResponse.json({ review: updated })
  } catch (error) {
    console.error('[vendor.reviews.respond] Unexpected PUT error', error)
    return NextResponse.json({ error: 'Failed to save response' }, { status: 500 })
  }
}
