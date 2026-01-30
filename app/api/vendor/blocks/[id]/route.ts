import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    // Verify user is a vendor
    const userType = user.user_metadata?.user_type
    if (userType !== 'vendor') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params
    const body = await request.json()

    // Verify block exists and belongs to user's vendor
    const { data: block, error: blockError } = await supabase
      .from('availability_blocks')
      .select('*, vendors!inner(owner_id)')
      .eq('id', id)
      .single()

    if (blockError || !block) {
      return NextResponse.json(
        { error: 'Block not found' },
        { status: 404 }
      )
    }

    // Verify vendor belongs to user
    if ((block.vendors as any).owner_id !== user.id) {
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

    // Update block
    const updates: any = {
      updated_at: new Date().toISOString(),
    }

    if (body.start_date !== undefined) {
      updates.start_date = body.start_date.split('T')[0]
    }
    if (body.end_date !== undefined) {
      updates.end_date = body.end_date.split('T')[0]
    }
    if (body.start_time !== undefined) updates.start_time = body.start_time
    if (body.end_time !== undefined) updates.end_time = body.end_time
    if (body.is_available !== undefined) updates.is_available = body.is_available
    if (body.reason !== undefined) updates.reason = body.reason

    const { data: updatedBlock, error: updateError } = await supabase
      .from('availability_blocks')
      .update(updates)
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
      block: updatedBlock,
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

    // Verify user is a vendor
    const userType = user.user_metadata?.user_type
    if (userType !== 'vendor') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params

    // Verify block exists and belongs to user's vendor
    const { data: block, error: blockError } = await supabase
      .from('availability_blocks')
      .select('*, vendors!inner(owner_id)')
      .eq('id', id)
      .single()

    if (blockError || !block) {
      return NextResponse.json(
        { error: 'Block not found' },
        { status: 404 }
      )
    }

    // Verify vendor belongs to user
    if ((block.vendors as any).owner_id !== user.id) {
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
