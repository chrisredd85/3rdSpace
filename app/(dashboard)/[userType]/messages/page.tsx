'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Search,
  Send,
  Building2,
  Store,
  Users,
  ExternalLink,
  Calendar,
  FileText,
  X,
  ArrowLeft,
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useMessageThreads,
  useMessages,
  useSendMessage,
  useMarkAsRead,
} from '@/lib/hooks/useMessages'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { MessageThread, Message } from '@/lib/types'

export default function MessagesPage() {
  const params = useParams()
  const userType = params.userType as string
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const { addToast } = useToast()
  const router = useRouter()

  const userId = user?.id || null

  // Loading and error handling
  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Please log in to continue</div>
      </div>
    )
  }

  const { data: threads = [], isLoading: threadsLoading } = useMessageThreads(userId)
  const { data: messages = [], isLoading: messagesLoading } = useMessages(selectedThreadId)
  const sendMessageMutation = useSendMessage()
  const markAsReadMutation = useMarkAsRead()

  // Filter threads by search query
  const filteredThreads = useMemo(() => {
    if (!searchQuery) return threads

    const query = searchQuery.toLowerCase()
    return threads.filter((thread) => {
      const participantName = thread.other_participant?.name || ''
      const lastMessage = thread.last_message?.content || ''
      return (
        participantName.toLowerCase().includes(query) ||
        lastMessage.toLowerCase().includes(query)
      )
    })
  }, [threads, searchQuery])

  // Get selected thread
  const selectedThread = useMemo(() => {
    return threads.find((t) => t.id === selectedThreadId) || null
  }, [threads, selectedThreadId])

  // Mark messages as read when thread is selected
  useEffect(() => {
    if (selectedThreadId && userId) {
      markAsReadMutation.mutate({
        threadId: selectedThreadId,
        userId,
      })
    }
  }, [selectedThreadId, userId, markAsReadMutation])

  // Auto-select first thread if none selected
  useEffect(() => {
    if (!selectedThreadId && filteredThreads.length > 0) {
      setSelectedThreadId(filteredThreads[0].id)
    }
  }, [filteredThreads, selectedThreadId])

  const handleSendMessage = async (content: string) => {
    if (!selectedThreadId || !userId || !content.trim()) return

    try {
      await sendMessageMutation.mutateAsync({
        threadId: selectedThreadId,
        senderId: userId,
        content: content.trim(),
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive',
      })
    }
  }

  const getContextLink = (thread: MessageThread) => {
    if (thread.venue_booking_id) {
      return `/builder/events?booking=${thread.venue_booking_id}`
    }
    if (thread.vendor_booking_id) {
      return `/builder/events?booking=${thread.vendor_booking_id}`
    }
    if (thread.event_id) {
      return `/builder/events/${thread.event_id}`
    }
    return null
  }

  const getParticipantType = (thread: MessageThread) => {
    // This would need to be determined from the participant's profile
    // For now, return a default
    return 'Business'
  }

  const [showThreadList, setShowThreadList] = useState(true)

  // On mobile, hide thread list when thread is selected
  useEffect(() => {
    if (selectedThreadId && window.innerWidth < 768) {
      setShowThreadList(false)
    }
  }, [selectedThreadId])

  return (
    <div className="flex h-[calc(100vh-8rem)] border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Left Column: Thread List */}
      <div className={cn(
        "w-full md:w-80 border-r border-gray-200 flex flex-col absolute md:relative inset-0 md:inset-auto z-10 md:z-auto bg-white",
        !showThreadList && "hidden md:flex"
      )}>
        {/* Search Bar */}
        <div className="p-4 border-b border-gray-200 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden min-h-[44px] min-w-[44px]"
            onClick={() => setShowThreadList(false)}
          >
            <X className="h-5 w-5" />
          </Button>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 min-h-[44px]"
            />
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto">
          {threadsLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-forest-500 border-t-transparent mx-auto mb-2" />
                <p className="text-xs text-gray-600">Loading threads...</p>
              </div>
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                <FileText className="h-6 w-6 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-900 mb-1">No conversations</p>
              <p className="text-xs text-gray-500">
                {searchQuery
                  ? 'No threads match your search'
                  : 'Start a conversation from an event or booking'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredThreads.map((thread) => {
                const isSelected = thread.id === selectedThreadId
                // Calculate unread count - messages from other participant that aren't read
              const unreadCount = thread.last_message && 
                thread.last_message.sender_id !== userId && 
                !thread.last_message.is_read ? 1 : 0

                return (
                  <ThreadItem
                    key={thread.id}
                    thread={thread}
                    isSelected={isSelected}
                    unreadCount={unreadCount}
                    onClick={() => setSelectedThreadId(thread.id)}
                    userType={userType}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Message View */}
      <div className="flex-1 flex flex-col relative">
        {selectedThread ? (
          <MessageView
            thread={selectedThread}
            messages={messages}
            isLoading={messagesLoading}
            onSendMessage={handleSendMessage}
            currentUserId={userId}
            userType={userType}
            contextLink={getContextLink(selectedThread)}
            onBack={() => setShowThreadList(true)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <FileText className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-900 mb-1">Select a conversation</p>
              <p className="text-xs text-gray-500">Choose a thread from the list to view messages</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface ThreadItemProps {
  thread: MessageThread & {
    last_message?: Message | null
    other_participant?: {
      id: string
      name: string | null
      avatar_url: string | null
    }
  }
  isSelected: boolean
  unreadCount: number
  onClick: () => void
  userType: string
}

function ThreadItem({ thread, isSelected, unreadCount, onClick, userType }: ThreadItemProps) {
  const participantName = thread.other_participant?.name || 'Unknown User'
  const lastMessage = thread.last_message?.content || 'No messages yet'
  const lastMessageTime = thread.last_message_at
    ? new Date(thread.last_message_at)
    : null

  const formatTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    } else if (days === 1) {
      return 'Yesterday'
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' })
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }

  // Determine icon based on context
  const getIcon = () => {
    if (thread.venue_booking_id) {
      return <Building2 className="h-5 w-5" />
    }
    if (thread.vendor_booking_id) {
      return <Store className="h-5 w-5" />
    }
    return <Users className="h-5 w-5" />
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-4 cursor-pointer hover:bg-gray-50 transition-colors',
        isSelected && 'bg-forest-50 border-l-4 border-l-forest-500'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-forest-400 to-forest-600 flex items-center justify-center text-white">
            {thread.other_participant?.avatar_url ? (
              <img
                src={thread.other_participant.avatar_url}
                alt={participantName}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <span className="text-sm font-semibold">
                {participantName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex-1 min-w-0">
              <p className={cn(
                'text-sm font-medium truncate',
                isSelected ? 'text-forest-900' : 'text-gray-900',
                unreadCount > 0 && 'font-semibold'
              )}>
                {participantName}
              </p>
              <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                {getIcon()}
                <span className="truncate">
                  {thread.venue_booking_id ? 'Venue' : thread.vendor_booking_id ? 'Vendor' : 'Event'}
                </span>
              </div>
            </div>
            {lastMessageTime && (
              <span className={cn(
                'text-xs whitespace-nowrap',
                isSelected ? 'text-forest-600' : 'text-gray-500'
              )}>
                {formatTime(lastMessageTime)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className={cn(
              'text-sm truncate',
              isSelected ? 'text-forest-700' : 'text-gray-600',
              unreadCount > 0 && 'font-medium text-gray-900'
            )}>
              {lastMessage}
            </p>
            {unreadCount > 0 && (
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-forest-500 text-white text-xs font-semibold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface MessageViewProps {
  thread: MessageThread & {
    other_participant?: {
      id: string
      name: string | null
      avatar_url: string | null
    }
  }
  messages: Message[]
  isLoading: boolean
  onSendMessage: (content: string) => void
  currentUserId: string | null
  userType: string
  contextLink: string | null
  onBack?: () => void
}

function MessageView({
  thread,
  messages,
  isLoading,
  onSendMessage,
  currentUserId,
  userType,
  contextLink,
  onBack,
}: MessageViewProps) {
  const [messageInput, setMessageInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const participantName = thread.other_participant?.name || 'Unknown User'

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (messageInput.trim()) {
      onSendMessage(messageInput)
      setMessageInput('')
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const formatMessageTime = (date: string) => {
    const messageDate = new Date(date)
    const now = new Date()
    const diff = now.getTime() - messageDate.getTime()
    const minutes = Math.floor(diff / (1000 * 60))

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
    return messageDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            {onBack && (
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden min-h-[44px] min-w-[44px]"
                onClick={onBack}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-forest-400 to-forest-600 flex items-center justify-center text-white">
              {thread.other_participant?.avatar_url ? (
                <img
                  src={thread.other_participant.avatar_url}
                  alt={participantName}
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <span className="text-sm font-semibold">
                  {participantName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{participantName}</h3>
              {contextLink && (
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Calendar className="h-3 w-3" />
                  <span>Re: Event</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {contextLink && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(contextLink)}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Booking
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Navigate to profile
                const profilePath = userType === 'builder'
                  ? `/builder/vendors/${thread.other_participant?.id}`
                  : `/builder/venues/${thread.other_participant?.id}`
                router.push(profilePath)
              }}
            >
              View Profile
            </Button>
          </div>
        </div>
      </div>

      {/* Message History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-forest-500 border-t-transparent mx-auto mb-2" />
              <p className="text-xs text-gray-600">Loading messages...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-sm text-gray-600">No messages yet</p>
              <p className="text-xs text-gray-500 mt-1">Start the conversation below</p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => {
              const isOwn = message.sender_id === currentUserId
              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex',
                    isOwn ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[70%] rounded-lg px-4 py-2',
                      isOwn
                        ? 'bg-forest-500 text-white'
                        : 'bg-white text-gray-900 border border-gray-200'
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {message.content}
                    </p>
                    <p
                      className={cn(
                        'text-xs mt-1',
                        isOwn ? 'text-forest-100' : 'text-gray-500'
                      )}
                    >
                      {formatMessageTime(message.created_at)}
                    </p>
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <textarea
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              rows={1}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-forest-500 focus:border-transparent"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
            <p className="text-xs text-gray-500 mt-1">
              All communication is logged
            </p>
          </div>
            <Button
              onClick={handleSend}
              disabled={!messageInput.trim() || sendMessageMutation.isPending}
              className="h-10"
            >
              <Send className="h-4 w-4" />
            </Button>
        </div>
      </div>
    </div>
  )
}
