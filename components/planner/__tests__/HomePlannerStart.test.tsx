import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomePlannerStart } from '@/components/planner/HomePlannerStart'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: mockPush,
    }
  },
}))

describe('HomePlannerStart', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
