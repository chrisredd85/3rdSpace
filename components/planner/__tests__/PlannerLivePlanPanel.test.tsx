import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerLivePlanPanel } from '@/components/planner/PlannerLivePlanPanel'
import type { PlanMessage } from '@/lib/types/planner'

describe('PlannerLivePlanPanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('updates the event brief when outreach and partner confirmations publish new plan data', async () => {
    window.localStorage.setItem('planner-live-plan', JSON.stringify({
      plan: makePlanSnapshot({
        title: 'Bay Area happy hour',
        guestCount: 40,
        neighborhood: 'San Francisco',
        budgetCapCents: 400000,
      }),
      messages: [
        makeConfirmationMessage('confirmation-initial', {
          event_type: 'happy_hour',
          guest_count: 40,
          area: 'San Francisco',
          budget_cents: 400000,
          ticketing_model: 'Free RSVP',
          food_responsibility: 'Need food model',
          vendor_needs: 'Need vendor confirmation',
          venue_terms: 'Need terms',
          action_permission: 'Approval required before outreach',
        }),
      ],
      planId: 'plan-brief-test',
    }))

    render(<PlannerLivePlanPanel inline />)

    expect(await screen.findByRole('heading', { name: 'Bay Area happy hour' })).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('Need food model')).toBeInTheDocument()
    expect(screen.getAllByText('Need terms').length).toBeGreaterThan(0)

    act(() => {
      window.dispatchEvent(new CustomEvent('planner-live-plan:update', {
        detail: {
          plan: makePlanSnapshot({
            title: 'Bay Area happy hour',
            guestCount: 72,
            neighborhood: 'Mission',
            budgetCapCents: 920000,
            selectedVendors: [
              {
                id: 'selected-vendor-1',
                vendor_id: 'vendor-catering-1',
                external_name: 'Souvla Catering',
                service_type: 'catering',
                price_cents: 185000,
                claim_status: 'claimed',
                rate_source: 'confirmed_private_rate',
                rate_provenance_label: 'Vendor confirmed availability and quote from outreach reply.',
              },
            ],
          }),
          messages: [
            makeConfirmationMessage('confirmation-initial', {
              event_type: 'happy_hour',
              guest_count: 40,
              area: 'San Francisco',
              budget_cents: 400000,
              ticketing_model: 'Free RSVP',
              food_responsibility: 'Need food model',
              vendor_needs: 'Need vendor confirmation',
              venue_terms: 'Need terms',
              action_permission: 'Approval required before outreach',
            }),
            makeRecommendationMessage('recommendation-confirmed', [
              {
                id: 'venue-1',
                name: 'Moongate Lounge',
                type: 'Venue',
                price_cents: 550000,
                address: 'Mission',
                capacity: 90,
                fit: 'Venue confirmed the hold window, minimum spend, and event fit through outreach.',
              },
            ]),
            makeConfirmationMessage('confirmation-updated', {
              event_type: 'happy_hour',
              guest_count: 72,
              area: 'Mission',
              budget_cents: 920000,
              ticketing_model: 'Ticketed',
              food_responsibility: 'Venue handles drinks; Souvla confirmed catering quote.',
              vendor_needs: 'Catering confirmed; no AV vendor needed.',
              venue_terms: 'Moongate Lounge confirmed $5,500 minimum spend.',
              action_permission: 'Host approval required before booking or payment.',
            }),
          ],
          planId: 'plan-brief-test',
        },
      }))
    })

    await waitFor(() => {
      expect(screen.getByText('72')).toBeInTheDocument()
      expect(screen.getByText('Mission')).toBeInTheDocument()
    })
    expect(screen.getByText('Venue handles drinks; Souvla confirmed catering quote.')).toBeInTheDocument()
    expect(screen.getByText('Moongate Lounge confirmed $5,500 minimum spend.')).toBeInTheDocument()
    expect(screen.getAllByText('Moongate Lounge').length).toBeGreaterThan(0)
    expect(screen.getByText('Souvla Catering')).toBeInTheDocument()
    expect(screen.getByText('Vendor confirmed availability and quote from outreach reply.')).toBeInTheDocument()
    expect(screen.queryByText('Need food model')).not.toBeInTheDocument()
  })

  it('includes venue consumption incentive revenue in the event brief profit window', async () => {
    window.localStorage.setItem('planner-live-plan', JSON.stringify({
      plan: makePlanSnapshot({
        title: 'Consumption venue happy hour',
        guestCount: 120,
        neighborhood: 'Mission',
        budgetCapCents: 0,
        ticketed: false,
        ticketingModel: 'Free RSVP',
      }),
      messages: [
        makeConfirmationMessage('confirmation-consumption', {
          event_type: 'happy_hour',
          guest_count: 120,
          area: 'Mission',
          budget_cents: 0,
          ticketing_model: 'Free RSVP',
          food_responsibility: 'Guests pay venue through a no-host cash bar.',
          venue_terms: 'Moongate Lounge proposed bar consumption CHI.',
          consumption_share: 'Bar consumption CHI at 12%.',
          action_permission: 'Host approval required before outreach.',
          ticketed: false,
        }),
      ],
      planId: 'plan-consumption-profit',
    }))

    render(<PlannerLivePlanPanel inline />)

    expect(await screen.findByRole('heading', { name: 'Consumption venue happy hour' })).toBeInTheDocument()
    expect(screen.getByText('Venue consumption incentive (bar CHI)')).toBeInTheDocument()
    expect(screen.getAllByText('$324').length).toBeGreaterThan(0)
    expect(screen.getByText('Per-attendee net')).toBeInTheDocument()
  })

  it('creates an approval-gated date-change request from the event brief', async () => {
    const user = userEvent.setup()
    const onDateChangeRequest = jest.fn().mockResolvedValue(undefined)
    window.localStorage.setItem('planner-live-plan', JSON.stringify({
      plan: makePlanSnapshot({
        title: 'Founder Dinner',
        guestCount: 72,
        neighborhood: 'Mission',
      }),
      messages: [
        makeConfirmationMessage('confirmation-date-change', {
          event_type: 'dinner',
          guest_count: 72,
          area: 'Mission',
          ticketing_model: 'Ticketed',
          action_permission: 'Approval required before outreach',
        }),
      ],
      planId: 'plan-date-change-test',
    }))

    render(<PlannerLivePlanPanel inline onDateChangeRequest={onDateChangeRequest} />)

    expect(await screen.findByRole('heading', { name: 'Founder Dinner' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /create approval/i }))
    fireEvent.change(screen.getByLabelText(/Proposed date/i), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText(/Partner name optional/i), { target: { value: 'Moongate Lounge' } })
    fireEvent.change(screen.getByLabelText(/Partner email optional/i), { target: { value: 'events@moongate.example' } })
    await user.click(screen.getByRole('button', { name: /create date-change approval/i }))

    await waitFor(() => {
      expect(onDateChangeRequest).toHaveBeenCalledWith({
        dateWindowStart: '2026-08-01',
        dateWindowEnd: '2026-08-01',
        note: null,
        targets: [{
          kind: 'venue',
          name: 'Moongate Lounge',
          email: 'events@moongate.example',
        }],
      })
    })
    expect(screen.getByText('Date-change approval created. Review it before partner emails send.')).toBeInTheDocument()
  })
})

function makePlanSnapshot(overrides: Record<string, unknown>) {
  return {
    title: 'Plan',
    eventType: 'happy_hour',
    status: 'ready',
    guestCount: null,
    budgetCapCents: null,
    neighborhood: null,
    dateWindowStart: '2026-07-17',
    dateWindowEnd: '2026-07-17',
    ticketed: null,
    ticketingModel: null,
    ticketPriceTargetCents: null,
    foodResponsibility: null,
    venueTerms: null,
    actionPermission: null,
    notes: null,
    runOfShow: null,
    workspaceSummary: null,
    selectedVendors: [],
    customCosts: [],
    updatedAt: '2026-06-16T16:00:00.000Z',
    ...overrides,
  }
}

function makeConfirmationMessage(id: string, summary: Record<string, unknown>): PlanMessage {
  return {
    id,
    plan_id: 'plan-brief-test',
    role: 'agent',
    content: 'Updated the event brief from confirmed partner details.',
    message_type: 'confirmation_card',
    metadata: { summary },
    created_at: '2026-06-16T16:00:00.000Z',
  }
}

function makeRecommendationMessage(id: string, recommendations: Array<Record<string, unknown>>): PlanMessage {
  return {
    id,
    plan_id: 'plan-brief-test',
    role: 'agent',
    content: 'Confirmed partner recommendations.',
    message_type: 'recommendation',
    metadata: { recommendations },
    created_at: '2026-06-16T16:05:00.000Z',
  }
}
