import { render, screen, waitFor } from '@testing-library/react'
import { PlannerResponsiveLayout } from '@/components/planner/mobile/PlannerResponsiveLayout'

let mockPathname = '/planner/outreach'

jest.mock('next/navigation', () => ({
  usePathname() {
    return mockPathname
  },
}))

jest.mock('@/components/planner/mobile/MobilePlanner', () => ({
  MobilePlanner({ activeSection, initialView }: { activeSection: string; initialView?: string }) {
    return (
      <div data-testid="mobile-planner" data-section={activeSection} data-view={initialView ?? ''}>
        Mobile planner
      </div>
    )
  },
}))

function setMobileMatchMedia(matches: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }))
}

describe('PlannerResponsiveLayout mobile route mapping', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    mockPathname = '/planner/outreach'
    setMobileMatchMedia(true)
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('routes /planner/outreach into the mobile outreach section', async () => {
    render(
      <PlannerResponsiveLayout>
        <div>Desktop outreach page</div>
      </PlannerResponsiveLayout>
    )

    await waitFor(() => expect(screen.getByTestId('mobile-planner')).toBeInTheDocument())
    expect(screen.getByTestId('mobile-planner')).toHaveAttribute('data-section', 'outreach')
  })

  it('leaves unmapped routes on their normal responsive page', () => {
    mockPathname = '/planner/experiences'

    render(
      <PlannerResponsiveLayout>
        <div>Experiences route</div>
      </PlannerResponsiveLayout>
    )

    expect(screen.getByText('Experiences route')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-planner')).not.toBeInTheDocument()
  })
})
