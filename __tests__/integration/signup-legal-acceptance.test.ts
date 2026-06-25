import { POST } from '@/app/api/auth/signup/route'

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    redirect: (url: string | URL) =>
      new Response(null, {
        status: 307,
        headers: { location: url.toString() },
      }),
  },
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

describe('/api/auth/signup legal acceptance', () => {
  it('rejects signup requests that have not accepted the current legal terms', async () => {
    const request = {
      json: async () => ({
        userType: 'community_builder',
        email: 'alex@example.com',
        password: 'password123',
        name: 'Alex Rivera',
        organization_name: 'Sunset Social Club',
        org_type: 'Social group / Community',
        bio: 'Recurring dinners.',
        event_types: ['Founder/operator dinner'],
        preferred_amenities: ['Full bar'],
      }),
    }

    const response = await POST(request as never)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/Terms of Service and Privacy Policy/i)
  })
})
