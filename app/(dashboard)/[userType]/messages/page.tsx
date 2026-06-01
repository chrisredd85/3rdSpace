'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Image from 'next/image'
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

  const { data: threads = [], isLoading: threadsLoading } = useMessageThreads(userId)
  const messagesQuery = useMessages(selectedThreadId)
  const messages = messagesQuery.data?.messages ?? []
  const messagesLoading = messagesQuery.isLoading
  const sendMessageMutation = useSendMessage()
  const markAsReadMutation = useMarkAsRead()

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
    if (!selectedThreadId || !content.trim()) return

    try {
      await sendMessageMutation.mutateAsync({
        thread_id: selectedThreadId,
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
      return userType === 'builder' ? `/planner/experiences?booking=${thread.venue_booking_id}` : `/${userType}/bookings`
    }
    if (thread.vendor_booking_id) {
      return userType === 'builder' ? `/planner/experiences?booking=${thread.vendor_booking_id}` : `/${userType}/bookings`
    }
    if (thread.event_id) {
      return userType === 'builder' ? '/planner/experiences' : `/${userType}/bookings`
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

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-ink-soft">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-brick">Please log in to continue</div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] border border-tan rounded-lg overflow-hidden bg-cream/40">
      {/* Left Column: Thread List */}
      <div className={cn(
        "w-full md:w-80 border-r border-tan flex flex-col absolute md:relative inset-0 md:inset-auto z-10 md:z-auto bg-cream/40",
        !showThreadList && "hidden md:flex"
      )}>
        {/* Search Bar */}
        <div className="p-4 border-b border-tan flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden min-h-[44px] min-w-[44px]"
            onClick={() => setShowThreadList(false)}
          >
            <X className="h-5 w-5" />
          </Button>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
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
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-clay border-t-transparent mx-auto mb-2" />
                <p className="text-xs text-ink-soft">Loading threads...</p>
              </div>
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <div className="h-12 w-12 rounded-full bg-cream-deep/40 flex items-center justify-center mb-4">
                <FileText className="h-6 w-6 text-ink-soft/60" />
              </div>
              <p className="text-sm font-medium text-ink mb-1">No conversations</p>
              <p className="text-xs text-ink-soft">
                {searchQuery
                  ? 'No threads match your search'
                  : 'Start a conversation from an event or booking'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-tan">
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
              <div className="h-16 w-16 rounded-full bg-cream-deep/40 flex items-center justify-center mx-auto mb-4">
                <FileText className="h-8 w-8 text-ink-soft/60" />
              </div>
              <p className="text-sm font-medium text-ink mb-1">Select a conversation</p>
              <p className="text-xs text-ink-soft">Choose a thread from the list to view messages</p>
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
    } | null
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
        'p-4 cursor-pointer hover:bg-cream transition-colors',
        isSelected && 'bg-clay/10 border-l-4 border-l-primary'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-clay/80 to-clay flex items-center justify-center text-cream">
            {thread.other_participant?.avatar_url ? (
              <Image
                src={thread.other_participant.avatar_url}
                alt={participantName}
                width={40}
                height={40}
                unoptimized
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
                isSelected ? 'text-clay' : 'text-ink',
                unreadCount > 0 && 'font-semibold'
              )}>
                {participantName}
              </p>
              <div className="flex items-center gap-1 text-xs text-ink-soft mt-0.5">
                {getIcon()}
                <span className="truncate">
                  {thread.venue_booking_id ? 'Venue' : thread.vendor_booking_id ? 'Vendor' : 'Event'}
                </span>
              </div>
            </div>
            {lastMessageTime && (
              <span className={cn(
                'text-xs whitespace-nowrap',
                isSelected ? 'text-clay' : 'text-ink-soft'
              )}>
                {formatTime(lastMessageTime)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className={cn(
              'text-sm truncate',
              isSelected ? 'text-clay' : 'text-ink-soft',
              unreadCount > 0 && 'font-medium text-ink'
            )}>
              {lastMessage}
            </p>
            {unreadCount > 0 && (
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-clay text-cream text-xs font-semibold flex items-center justify-center">
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
    } | null
  }
  messages: Message[]
  isLoading: boolean
  onSendMessage: (content: string) => void
  isSending?: boolean
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
  isSending = false,
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
      <div className="p-4 border-b border-tan bg-cream/40">
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
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-clay/80 to-clay flex items-center justify-center text-cream">
              {thread.other_participant?.avatar_url ? (
                <Image
                  src={thread.other_participant.avatar_url}
                  alt={participantName}
                  width={40}
                  height={40}
                  unoptimized
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <span className="text-sm font-semibold">
                  {participantName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">{participantName}</h3>
              {contextLink && (
                <div className="flex items-center gap-1 text-xs text-ink-soft">
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
                  ? `/planner/vendors/${thread.other_participant?.id}`
                  : `/${userType}/bookings`
                router.push(profilePath)
              }}
            >
              View Profile
            </Button>
          </div>
        </div>
      </div>

      {/* Message History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-cream">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-clay border-t-transparent mx-auto mb-2" />
              <p className="text-xs text-ink-soft">Loading messages...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-sm text-ink-soft">No messages yet</p>
              <p className="text-xs text-ink-soft mt-1">Start the conversation below</p>
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
                        ? 'bg-clay text-cream'
                        : 'bg-cream/40 text-ink border border-tan'
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {message.content}
                    </p>
                    <p
                      className={cn(
                        'text-xs mt-1',
                        isOwn ? 'text-clay/20' : 'text-ink-soft'
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
      <div className="p-4 border-t border-tan bg-cream/40">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <textarea
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              rows={1}
              className="w-full rounded-md border border-tan px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-clay focus:border-transparent"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
            <p className="text-xs text-ink-soft mt-1">
              All communication is logged
            </p>
          </div>
            <Button
              onClick={handleSend}
              disabled={!messageInput.trim() || isSending}
              className="h-10"
            >
              <Send className="h-4 w-4" />
            </Button>
        </div>
      </div>
    </div>
  )
}
