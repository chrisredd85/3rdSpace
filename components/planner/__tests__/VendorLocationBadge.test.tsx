import { render, screen } from '@testing-library/react'
import { VendorLocationBadge } from '@/components/planner/VendorLocationBadge'

describe('VendorLocationBadge', () => {
  it('hides same-city vendors when no neighborhood context is needed', () => {
    const { container } = render(<VendorLocationBadge eventCity="Oakland" vendorCity="Oakland" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels same-city vendors by neighborhood', () => {
    render(<VendorLocationBadge eventCity="Oakland" vendorCity="Oakland" neighborhood="Uptown Oakland" />)
    expect(screen.getByText('Uptown Oakland')).toBeInTheDocument()
  })

  it('marks adjacent-city vendors approved by the organizer', () => {
    render(<VendorLocationBadge eventCity="Oakland" vendorCity="Berkeley" approved />)
    expect(screen.getByText('Berkeley - approved')).toBeInTheDocument()
  })

  it('marks vendors that serve the event city', () => {
    render(<VendorLocationBadge eventCity="Oakland" vendorCity="Berkeley" servesEventCity />)
    expect(screen.getByText('Berkeley - serves Oakland')).toBeInTheDocument()
  })

  it('warns when an out-of-city vendor needs confirmation', () => {
    render(<VendorLocationBadge eventCity="Oakland" vendorCity="San Francisco" />)
    expect(screen.getByText('San Francisco - confirm if you want vendors from outside Oakland')).toBeInTheDocument()
  })

  it('labels special supply as Bay Area service', () => {
    render(<VendorLocationBadge vendorCity="Sausalito" specialSupply />)
    expect(screen.getByText('Sausalito - serves Bay Area')).toBeInTheDocument()
  })
})
