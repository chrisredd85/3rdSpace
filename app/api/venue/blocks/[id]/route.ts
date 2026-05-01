export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeAvailabilityBlock,
  toAvailabilityBlockUpdate,
  type AvailabilityBlockRow,
} from '@/lib/bookings/availability-adapter'

interface RouteContext {
  params: {
    id: string
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const supabase = createClient()

    // Verify user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Verify user is a venue owner
    const userType = user.user_metadata?.user_type
    if (userType !== 'venue_owner') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params
    const body = await request.json()

    // Verify block exists and belongs to one of the user's venues
    const { data: block, error: blockError } = await supabase
      .from('availability_blocks')
      .select('*')
      .eq('id', id)
      .single()

    if (blockError || !block) {
      return NextResponse.json(
        { error: 'Block not found' },
        { status: 404 }
      )
    }

    const blockRow = block as AvailabilityBlockRow
    if (blockRow.blockable_type !== 'venue') {
      return NextResponse.json(
        { error: 'Block not found' },
        { status: 404 }
      )
    }

    const { data: venue } = await supabase
      .from('venues')
      .select('id, owner_id')
      .eq('id', blockRow.blockable_id)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (!venue) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Validate dates if provided
    if (body.start_date && body.end_date) {
      const start = new Date(body.start_date)
      const end = new Date(body.end_date)

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return NextResponse.json(
          { error: 'Invalid date format' },
          { status: 400 }
        )
      }

      if (end < start) {
        return NextResponse.json(
          { error: 'end_date must be after start_date' },
          { status: 400 }
        )
      }
    }

    const updates = toAvailabilityBlockUpdate(body)

    const { data: updatedBlock, error: updateError } = await supabase
      .from('availability_blocks')
      .update(updates as never)
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating block:', updateError)
      return NextResponse.json(
        { error: 'Failed to update block' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      block: normalizeAvailabilityBlock(updatedBlock as AvailabilityBlockRow),
    })
  } catch (error) {
    console.error('Update block error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const supabase = createClient()

    // Verify user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Verify user is a venue owner
    const userType = user.user_metadata?.user_type
    if (userType !== 'venue_owner') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params

    // Verify block exists and belongs to one of the user's venues
    const { data: block, error: blockError } = await supabase
      .from('availability_blocks')
      .select('*')
      .eq('id', id)
      .single()

    if (blockError || !block) {
      return NextResponse.json(
        { error: 'Block not found' },
        { status: 404 }
      )
    }

    const blockRow = block as AvailabilityBlockRow
    if (blockRow.blockable_type !== 'venue') {
      return NextResponse.json(
        { error: 'Block not found' },
        { status: 404 }
      )
    }

    const { data: venue } = await supabase
      .from('venues')
      .select('id, owner_id')
      .eq('id', blockRow.blockable_id)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (!venue) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Delete block
    const { error: deleteError } = await supabase
      .from('availability_blocks')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting block:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete block' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Block deleted successfully',
    })
  } catch (error) {
    console.error('Delete block error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
