import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MessagesPage from '../page'
import { useMessageThreads, useMessages, useSendMessage, useMarkAsRead } from '@/lib/hooks/useMessages'
import { useUser } from '@/lib/hooks/useUser'

const mockPush = jest.fn()
const mockToast = jest.fn()
const mockMarkAsRead = jest.fn()
const mockSendMessage = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: mockPush,
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
    }
  },
}))

jest.mock('@/lib/hooks/useUser', () => ({
  useUser: jest.fn(),
}))

jest.mock('@/lib/hooks/useMessages', () => ({
  useMessageThreads: jest.fn(),
  useMessages: jest.fn(),
  useSendMessage: jest.fn(),
  useMarkAsRead: jest.fn(),
}))

jest.mock('@/components/ui/toast', () => ({
  useToast() {
    return { addToast: mockToast }
  },
}))

const threadOne = {
  id: 'thread-1',
  participant_1_id: 'builder-user-1',
  participant_2_id: 'vendor-user-1',
  event_id: null,
  booking_id: 'booking-1',
  booking_type: 'vendor_booking',
  venue_booking_id: null,
  vendor_booking_id: 'booking-1',
  last_message_at: '2026-07-01T10:00:00.000Z',
  created_at: '2026-07-01T08:00:00.000Z',
  updated_at: '2026-07-01T10:00:00.000Z',
  unread_count: 0,
  other_participant: {
    id: 'vendor-user-1',
    name: 'Moongate Lounge',
    email: 'vendor@example.com',
    avatar_url: null,
  },
  last_message: {
    id: 'msg-1',
    thread_id: 'thread-1',
    vendor_booking_id: 'booking-1',
    sender_id: 'vendor-user-1',
    content: 'We can hold the date.',
    read: null,
    is_read: false,
    read_at: null,
    created_at: '2026-07-01T10:00:00.000Z',
  },
}

const threadTwo = {
  ...threadOne,
  id: 'thread-2',
  booking_id: 'booking-2',
  vendor_booking_id: 'booking-2',
  other_participant: {
    id: 'vendor-user-2',
    name: 'The Pearl SF',
    email: 'pearl@example.com',
    avatar_url: null,
  },
  last_message: {
    ...threadOne.last_message,
    id: 'msg-2',
    thread_id: 'thread-2',
    vendor_booking_id: 'booking-2',
    content: 'The Pearl can do Friday.',
  },
}

function mockLoggedInUser() {
  ;(useUser as jest.Mock).mockReturnValue({
    user: { id: 'builder-user-1' },
    isLoading: false,
    error: null,
  })
}

function mockMessageHooks(threads: typeof threadOne[] = []) {
  ;(useMessageThreads as jest.Mock).mockReturnValue({
    data: threads,
    isLoading: false,
    error: null,
  })
  ;(useMessages as jest.Mock).mockImplementation((threadId: string | null) => ({
    data: threadId
      ? {
          thread: threads.find((thread) => thread.id === threadId),
          messages: [
            {
              id: `message-${threadId}`,
              thread_id: threadId,
              vendor_booking_id: threadId === 'thread-2' ? 'booking-2' : 'booking-1',
              sender_id: threadId === 'thread-2' ? 'vendor-user-2' : 'vendor-user-1',
              content: threadId === 'thread-2' ? 'Selected thread two body' : 'Selected thread one body',
              read: null,
              is_read: false,
              read_at: null,
              created_at: '2026-07-01T10:00:00.000Z',
            },
          ],
          count: 1,
        }
      : undefined,
    isLoading: false,
  }))
  ;(useSendMessage as jest.Mock).mockReturnValue({
    mutateAsync: mockSendMessage,
    isPending: false,
  })
  ;(useMarkAsRead as jest.Mock).mockReturnValue({
    mutate: mockMarkAsRead,
  })
}

describe('MessagesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.history.pushState(null, '', '/planner/messages')
    mockLoggedInUser()
    mockSendMessage.mockResolvedValue({})
  })

  it('explains an empty direct-message inbox and routes organizers to outreach approvals', async () => {
    const user = userEvent.setup()
    mockMessageHooks([])

    render(<MessagesPage />)

    expect(screen.getByText('No conversations')).toBeInTheDocument()
    expect(screen.getByText('Direct booking conversations appear here after a vendor booking thread is created.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go to outreach approvals' }))

    expect(mockPush).toHaveBeenCalledWith('/planner/outreach')
  })

  it('opens a planner messages deep link to the requested thread', async () => {
    window.history.pushState(null, '', '/planner/messages?thread=thread-2')
    mockMessageHooks([threadOne, threadTwo])

    render(<MessagesPage />)

    expect(await screen.findByText('Selected thread two body')).toBeInTheDocument()
    expect(screen.getAllByText('The Pearl SF').length).toBeGreaterThanOrEqual(1)
    await waitFor(() => {
      expect(mockMarkAsRead).toHaveBeenCalledWith({
        threadId: 'thread-2',
        userId: 'builder-user-1',
      })
    })
  })

  it('sends a direct booking message through the current thread and clears the composer on success', async () => {
    const user = userEvent.setup()
    mockMessageHooks([threadOne])

    render(<MessagesPage />)

    const composer = await screen.findByPlaceholderText('Type a direct message...')
    await user.type(composer, 'Can you send the update?')
    await user.click(screen.getByRole('button', { name: 'Send direct message' }))

    expect(mockSendMessage).toHaveBeenCalledWith({
      thread_id: 'thread-1',
      content: 'Can you send the update?',
    })
    expect(composer).toHaveValue('')
  })
})
