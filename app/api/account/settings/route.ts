export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { UserType } from '@/lib/types'

export const runtime = 'nodejs'

const optionalName = (message: string, max: number) =>
  z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(2, message).max(max).optional()
  )

const settingsSchema = z.object({
  email: z.string().email('Enter a valid email address').optional(),
  displayName: optionalName('Name must be at least 2 characters', 120),
  companyName: optionalName('Business name must be at least 2 characters', 160),
  phone: z.string().trim().max(40).optional(),
})

type AccountProfile = {
  id: string
  email: string | null
  userType: UserType
  role: string
  companyName: string | null
  displayName: string | null
  phone: string | null
}

/**
 * Returns editable account settings for the authenticated dashboard user.
 */
export async function GET() {
  try {
    const auth = await requireAccount()
    if ('response' in auth) return auth.response

    return NextResponse.json({ profile: await loadProfile(auth.admin, auth.user.id, auth.account) })
  } catch (error) {
    console.error('[account.settings.GET] Failed to load settings', error)
    return NextResponse.json({ error: 'Failed to load account settings' }, { status: 500 })
  }
}

/**
 * Updates contact/account metadata and starts Supabase's email-change flow when needed.
 */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAccount()
    if ('response' in auth) return auth.response

    const parsed = settingsSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid account settings', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { email, displayName, companyName, phone } = parsed.data
    const now = new Date().toISOString()
    const updates: Record<string, unknown> = { updated_at: now }

    if (companyName !== undefined) updates.company_name = companyName

    if (email && email !== auth.user.email) {
      const { error: emailError } = await auth.supabase.auth.updateUser({ email })
      if (emailError) {
        return NextResponse.json({ error: emailError.message }, { status: 400 })
      }
    }

    if (Object.keys(updates).length > 1) {
      const { error } = await auth.admin
        .from('users')
        .update(updates as never)
        .eq('id', auth.user.id)

      if (error) throw new Error(`Failed to update account: ${error.message}`)
    }

    await updateRoleProfile(auth.admin, auth.user.id, auth.account.userType, {
      displayName,
      companyName,
      phone,
      updatedAt: now,
    })

    const profile = await loadProfile(auth.admin, auth.user.id, auth.account)
    return NextResponse.json({
      profile,
      message: email && email !== auth.user.email
        ? 'Account saved. Check your inbox to confirm the new email address.'
        : 'Account saved.',
    })
  } catch (error) {
    console.error('[account.settings.PATCH] Failed to save settings', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save account settings' },
      { status: 500 }
    )
  }
}

async function requireAccount() {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const admin = createServiceRoleClient()
  const { data: account, error } = await admin
    .from('users')
    .select('id, email, role, user_type, company_name')
    .eq('id', user.id)
    .single()

  if (error || !account) {
    return { response: NextResponse.json({ error: 'Account not found' }, { status: 404 }) }
  }

  const row = account as {
    id: string
    email: string | null
    role: string
    user_type: UserType | null
    company_name: string | null
  }

  const userType = row.user_type || roleToUserType(row.role)
  return {
    supabase,
    admin,
    user,
    account: {
      id: row.id,
      email: user.email || row.email || null,
      role: row.role,
      userType,
      companyName: row.company_name,
    },
  }
}

function roleToUserType(role: string): UserType {
  if (role === 'owner') return 'venue_owner'
  if (role === 'vendor') return 'vendor'
  return 'community_builder'
}

async function loadProfile(admin: any, userId: string, account: {
  id: string
  email: string | null
  role: string
  userType: UserType
  companyName: string | null
}): Promise<AccountProfile> {
  if (account.userType === 'venue_owner') {
    const { data } = await admin
      .from('owner_profiles')
      .select('name, phone, business_name')
      .eq('user_id', userId)
      .maybeSingle()

    const owner = data as { name?: string | null; phone?: string | null; business_name?: string | null } | null
    return {
      id: userId,
      email: account.email,
      userType: account.userType,
      role: account.role,
      companyName: owner?.business_name || account.companyName,
      displayName: owner?.name || null,
      phone: owner?.phone || null,
    }
  }

  if (account.userType === 'vendor') {
    const { data } = await admin
      .from('vendor_profiles')
      .select('name, phone')
      .eq('user_id', userId)
      .maybeSingle()

    const vendor = data as { name?: string | null; phone?: string | null } | null
    return {
      id: userId,
      email: account.email,
      userType: account.userType,
      role: account.role,
      companyName: account.companyName,
      displayName: vendor?.name || null,
      phone: vendor?.phone || null,
    }
  }

  const { data } = await admin
    .from('builder_profiles')
    .select('name, phone')
    .eq('user_id', userId)
    .maybeSingle()

  const builder = data as { name?: string | null; phone?: string | null } | null
  return {
    id: userId,
    email: account.email,
    userType: account.userType,
    role: account.role,
    companyName: account.companyName,
    displayName: builder?.name || null,
    phone: builder?.phone || null,
  }
}

async function updateRoleProfile(
  admin: any,
  userId: string,
  userType: UserType,
  updates: {
    displayName?: string
    companyName?: string
    phone?: string
    updatedAt: string
  }
) {
  const roleUpdates: Record<string, unknown> = { updated_at: updates.updatedAt }
  if (updates.displayName !== undefined) roleUpdates.name = updates.displayName
  if (updates.phone !== undefined) roleUpdates.phone = updates.phone || null

  if (userType === 'venue_owner') {
    if (updates.companyName !== undefined) roleUpdates.business_name = updates.companyName
    if (Object.keys(roleUpdates).length > 1) {
      const { error } = await admin
        .from('owner_profiles')
        .update(roleUpdates as never)
        .eq('user_id', userId)

      if (error) throw new Error(`Failed to update venue owner profile: ${error.message}`)
    }

    if (updates.companyName !== undefined) {
      const { error } = await admin
        .from('venues')
        .update({ venue_name: updates.companyName, updated_at: updates.updatedAt } as never)
        .eq('owner_id', userId)

      if (error) throw new Error(`Failed to update venue name: ${error.message}`)
    }
    return
  }

  if (userType === 'vendor') {
    if (Object.keys(roleUpdates).length > 1) {
      const { error } = await admin
        .from('vendor_profiles')
        .update(roleUpdates as never)
        .eq('user_id', userId)

      if (error) throw new Error(`Failed to update vendor profile: ${error.message}`)
    }
    return
  }

  if (Object.keys(roleUpdates).length > 1) {
    const { error } = await admin
      .from('builder_profiles')
      .update(roleUpdates as never)
      .eq('user_id', userId)

    if (error) throw new Error(`Failed to update builder profile: ${error.message}`)
  }
}
