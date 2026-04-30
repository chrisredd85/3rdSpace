export const e2ePersonas = {
  builder: {
    role: 'builder',
    email: 'e2e-builder@3rdspace.test',
    organizationName: 'E2E Event Hosts',
    eventName: 'E2E Friday Mixer',
    expectedAttendees: 100,
  },
  venue: {
    role: 'venue',
    email: 'e2e-venue@3rdspace.test',
    venueName: 'E2E Bar & Lounge',
    perHeadKickback: 3,
  },
  vendor: {
    role: 'vendor',
    email: 'e2e-dj@3rdspace.test',
    businessName: 'E2E DJ',
    serviceType: 'dj',
    hourlyRate: 45,
  },
} as const

export const businessScenarios = {
  verifiedAttendance: 100,
  djHours: 4,
} as const
