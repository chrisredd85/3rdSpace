import { ExperiencesBookingMockup } from '@/components/planner/experiences-mockup/ExperiencesBookingMockup'

export const metadata = {
  title: 'Booking Page Mockup | 3rdPlace',
}

interface ExperiencesMockupPageProps {
  searchParams?: {
    state?: string
  }
}

// Phase 1 mockup -- static data for design review. Phase 2 will wire to real Supabase sources.
export default function ExperiencesMockupPage({ searchParams }: ExperiencesMockupPageProps) {
  const bannerState = searchParams?.state === 'calm' ? 'calm' : 'urgent'

  return <ExperiencesBookingMockup initialBannerState={bannerState} />
}
