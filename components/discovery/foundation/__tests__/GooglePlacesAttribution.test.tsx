import { render, screen, within } from '@testing-library/react'

import { GooglePlacesAttribution } from '../GooglePlacesAttribution'

describe('GooglePlacesAttribution', () => {
  it('renders Google Maps, all author profiles, and the individual photo source together', () => {
    render(<GooglePlacesAttribution photo={{
      googleMapsUri: 'https://www.google.com/maps/photo/fixture-one',
      authorAttributions: [
        { displayName: 'Alex Example', uri: 'https://www.google.com/maps/contrib/alex' },
        { displayName: 'Jordan Example', uri: 'https://www.google.com/maps/contrib/jordan' },
      ],
    }} />)

    const credit = within(screen.getByLabelText('Google Maps attribution'))
    expect(credit.getByText('Google Maps')).toBeVisible()
    expect(credit.getByRole('link', { name: 'Alex Example' })).toHaveAttribute('href', 'https://www.google.com/maps/contrib/alex')
    expect(credit.getByRole('link', { name: 'Jordan Example' })).toHaveAttribute('href', 'https://www.google.com/maps/contrib/jordan')
    expect(credit.getByRole('link', { name: 'View photo on Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/photo/fixture-one')
    for (const link of credit.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('shows supplied names as text when no safe profile link exists', () => {
    render(<GooglePlacesAttribution photo={{
      googleMapsUri: 'javascript:alert(1)',
      authorAttributions: [
        { displayName: 'Name only' },
        { displayName: 'Unsafe profile', uri: 'data:text/html,unsafe' },
      ],
    }} />)

    expect(screen.getByText('Name only')).toBeVisible()
    expect(screen.getByText('Unsafe profile')).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('labels a profile-only link without fabricating an author name', () => {
    render(<GooglePlacesAttribution photo={{
      authorAttributions: [{ uri: 'https://www.google.com/maps/contrib/profile-only' }],
    }} />)

    expect(screen.getByRole('link', { name: 'Contributor profile' })).toHaveAttribute('href', 'https://www.google.com/maps/contrib/profile-only')
    expect(screen.queryByText(/unknown author|anonymous/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View photo on Google Maps' })).not.toBeInTheDocument()
  })

  it.each([null, [], 'malformed', {}])('keeps Google attribution without inventing photo credit for %s', (photo) => {
    render(<GooglePlacesAttribution photo={photo} />)

    expect(screen.getByText('Google Maps')).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Google Maps attribution')).toHaveTextContent(/^Google Maps$/)
  })

  it('renders provider text as text rather than markup', () => {
    const { container } = render(<GooglePlacesAttribution photo={{
      authorAttributions: [{ displayName: '<img src=x onerror=alert(1)>' }],
    }} />)

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })
})
