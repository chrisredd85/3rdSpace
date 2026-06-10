import { POST as oldCheckoutPost } from '@/app/api/venue/kickbacks/[id]/checkout/route'
import { POST as oldRefundPost } from '@/app/api/venue/kickbacks/[id]/refund-request/route'
import { POST as oldSpendReportPost } from '@/app/api/venue/kickbacks/[id]/spend-report/route'
import { GET as oldSummaryGet } from '@/app/api/venue/kickbacks/summary/route'

const ID = '11111111-1111-4111-8111-111111111111'

describe('legacy venue settlement route redirects', () => {
  it('redirects legacy checkout calls to the CHI endpoint', async () => {
    const response = oldCheckoutPost(
      new Request(`http://localhost/api/venue/kickbacks/${ID}/checkout`) as never,
      { params: { id: ID } }
    )

    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(
      `http://localhost/api/venue/community-host-incentive/${ID}/checkout`
    )
  })

  it('redirects legacy refund calls to the CHI endpoint', async () => {
    const response = oldRefundPost(
      new Request(`http://localhost/api/venue/kickbacks/${ID}/refund-request`) as never,
      { params: { id: ID } }
    )

    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(
      `http://localhost/api/venue/community-host-incentive/${ID}/refund-request`
    )
  })

  it('redirects legacy spend-report calls to the CHI endpoint', async () => {
    const response = oldSpendReportPost(
      new Request(`http://localhost/api/venue/kickbacks/${ID}/spend-report`) as never,
      { params: { id: ID } }
    )

    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(
      `http://localhost/api/venue/community-host-incentive/${ID}/spend-report`
    )
  })

  it('redirects the legacy summary route to the CHI endpoint', async () => {
    const response = oldSummaryGet(
      new Request('http://localhost/api/venue/kickbacks/summary') as never
    )

    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(
      'http://localhost/api/venue/community-host-incentive/summary'
    )
  })
})
