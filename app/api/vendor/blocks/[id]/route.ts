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

async function requireVendorAccount(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('role, user_type')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('[vendor.blocks.id] Failed to load user account', error)
    return false
  }

  const account = data as { role?: string | null; user_type?: string | null } | null
  return account?.role === 'vendor' || account?.user_type === 'vendor'
}

async function getOwnedVendorIds(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabase
    .from('vendor_profiles')
    .select('id')
    .eq('user_id', userId)

  if (error) {
    console.error('[vendor.blocks.id] Failed to load vendor profiles', error)
    return null
  }

  return ((data || []) as Array<{ id: string }>).map((vendor) => vendor.id)
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

    if (!(await requireVendorAccount(supabase, user.id))) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params
    const body = await request.json()
    const vendorIds = await getOwnedVendorIds(supabase, user.id)

    if (!vendorIds || vendorIds.length === 0) {
      return NextResponse.json(
        { error: 'Vendor profile not found' },
        { status: 404 }
      )
    }

    // Verify block exists and belongs to the user's vendor profile
    const { data: block, error: blockError } = await supabase
      .from('availability_blocks')
      .select('*')
      .eq('id', id)
      .eq('blockable_type', 'vendor')
      .in('blockable_id', vendorIds)
      .maybeSingle()

    if (blockError || !block) {
      return NextResponse.json(
        { error: 'Block not found' },
        { status: 404 }
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
      .eq('blockable_type', 'vendor')
      .in('blockable_id', vendorIds)
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

    if (!(await requireVendorAccount(supabase, user.id))) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params
    const vendorIds = await getOwnedVendorIds(supabase, user.id)

    if (!vendorIds || vendorIds.length === 0) {
      return NextResponse.json(
        { error: 'Vendor profile not found' },
        { status: 404 }
      )
    }

    // Verify block exists and belongs to the user's vendor profile
    const { data: block, error: blockError } = await supabase
      .from('availability_blocks')
      .select('*')
      .eq('id', id)
      .eq('blockable_type', 'vendor')
      .in('blockable_id', vendorIds)
      .maybeSingle()

    if (blockError || !block) {
      return NextResponse.json(
        { error: 'Block not found' },
        { status: 404 }
      )
    }

    // Delete block
    const { error: deleteError } = await supabase
      .from('availability_blocks')
      .delete()
      .eq('id', id)
      .eq('blockable_type', 'vendor')
      .in('blockable_id', vendorIds)

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
