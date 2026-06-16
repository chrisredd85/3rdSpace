jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))
jest.mock('@/lib/email', () => ({
  sendEmailNotification: jest.fn(),
}))

import { resolveVendorClaimCatalogFields } from '@/lib/vendors/vendorClaims'

describe('resolveVendorClaimCatalogFields', () => {
  it('keeps private invited vendors unpublished when no public catalog rate is provided', () => {
    expect(resolveVendorClaimCatalogFields(null, 'flat')).toEqual({
      ok: true,
      update: { is_published: false },
    })
  })

  it('publishes a claimed vendor only when a positive public catalog rate is provided', () => {
    expect(resolveVendorClaimCatalogFields(650, 'flat')).toEqual({
      ok: true,
      update: {
        is_published: true,
        base_rate: 65000,
        pricing_model: 'flat_rate',
      },
    })
  })

  it('rejects non-positive public catalog rates', () => {
    expect(resolveVendorClaimCatalogFields(0, 'hourly')).toEqual({
      ok: false,
      error: 'Enter a public base rate greater than 0, or leave it blank to stay private.',
    })
  })
})
