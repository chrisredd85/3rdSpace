import { NextRequest, NextResponse } from 'next/server'
import { middleware } from '@/middleware'
import { getAuthUser, protectRoute } from '@/lib/supabase/middleware'

jest.mock('@/lib/supabase/middleware', () => ({
  getAuthUser: jest.fn(),
  protectRoute: jest.fn(),
}))

const mockGetAuthUser = getAuthUser as jest.Mock
const mockProtectRoute = protectRoute as jest.Mock

function request(url: string) {
  const nextUrl = new URL(url) as URL & { clone: () => URL }
  nextUrl.clone = () => {
    const cloned = new URL(nextUrl.toString()) as URL & { clone: () => URL }
    cloned.clone = () => new URL(cloned.toString())
    return cloned
  }

  return {
    headers: new Headers(),
    method: 'GET',
    nextUrl,
  } as NextRequest
}

function loginRedirect(req: NextRequest) {
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('redirect', req.nextUrl.pathname)
  return NextResponse.redirect(url)
}

describe('middleware auth redirects', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends unauthenticated protected planner routes to creator signup', async () => {
    mockProtectRoute.mockImplementation(async (req: NextRequest) => loginRedirect(req))

    const response = await middleware(
      request('https://www.3rdplace.io/planner/tickets?platform=eventbrite')
    )

    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toBe(
      'https://www.3rdplace.io/signup/builder?redirect=%2Fplanner%2Ftickets%3Fplatform%3Deventbrite'
    )
  })

  it('keeps anonymous planner intake public before account creation', async () => {
    const publicResponse = NextResponse.next()
    mockGetAuthUser.mockResolvedValue({ user: null, response: publicResponse })

    const response = await middleware(request('https://www.3rdplace.io/planner'))

    expect(response).toBe(publicResponse)
    expect(mockProtectRoute).not.toHaveBeenCalled()
  })

  it('preserves the login redirect for unauthenticated venue routes', async () => {
    mockProtectRoute.mockImplementation(async (req: NextRequest) => loginRedirect(req))

    const response = await middleware(request('https://www.3rdplace.io/venue/payouts'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://www.3rdplace.io/login?redirect=%2Fvenue%2Fpayouts'
    )
  })
})
