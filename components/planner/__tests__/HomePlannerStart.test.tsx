import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomePlannerStart } from '@/components/planner/HomePlannerStart'
import { pendingEventDraftStorageKey } from '@/lib/planner/pendingEventDraft'

const mockPush = jest.fn()
const mockGetSession = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: mockPush,
    }
  },
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient() {
    return {
      auth: {
        getSession: mockGetSession,
      },
    }
  },
}))

describe('HomePlannerStart', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })
  })

  it('shows starter chips that represent distinct planner powers', () => {
    render(<HomePlannerStart />)

    expect(screen.getByRole('button', { name: 'Founder dinner, 36, Mission, $5k budget' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ticketed mixer, 80, SoMa, find 3 venues' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repeat a past event, new date' })).toBeInTheDocument()
  })

  it('routes the repeat-event chip into the planner rebook flow', async () => {
    const user = userEvent.setup()
    render(<HomePlannerStart />)

    await user.click(screen.getByRole('button', { name: 'Repeat a past event, new date' }))

    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/planner\/new-plan\?/))
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('intent=rebook'))
  })

  it('preserves signed-out homepage submissions for signup instead of routing to a local draft', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    const user = userEvent.setup()
    render(<HomePlannerStart />)

    await user.type(screen.getByLabelText('Describe the event you want to host'), 'Happy hour for 40 in Oakland')
    await user.click(screen.getByRole('button', { name: 'Send event draft' }))

    expect(mockPush).toHaveBeenCalledWith('/signup/builder?returnTo=%2Fplanner&draft=pending')
    expect(JSON.parse(window.localStorage.getItem(pendingEventDraftStorageKey) ?? '{}')).toEqual(
      expect.objectContaining({
        prompt: 'Happy hour for 40 in Oakland',
        timestamp: expect.any(Number),
      })
    )
  })

  it('routes authenticated homepage submissions into the real planner', async () => {
    const user = userEvent.setup()
    render(<HomePlannerStart />)

    await user.type(screen.getByLabelText('Describe the event you want to host'), 'Dinner for 20 in Mission')
    await user.click(screen.getByRole('button', { name: 'Send event draft' }))

    expect(mockPush).toHaveBeenCalledWith('/planner?draft=Dinner+for+20+in+Mission')
    expect(window.localStorage.getItem(pendingEventDraftStorageKey)).toBeNull()
  })

  it('keeps ordinary event chips as editable draft prompts', async () => {
    const user = userEvent.setup()
    render(<HomePlannerStart />)

    await user.click(screen.getByRole('button', { name: 'Ticketed mixer, 80, SoMa, find 3 venues' }))

    expect(screen.getByLabelText('Describe the event you want to host')).toHaveValue(
      'Ticketed mixer for 80 in SoMa - find and compare three venue options'
    )
    expect(mockPush).not.toHaveBeenCalled()
  })
})
